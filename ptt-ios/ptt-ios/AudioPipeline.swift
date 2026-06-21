//
//  AudioPipeline.swift
//  PTTClient
//
//  Step B: マイク入力 → Opusエンコード → WebSocket送信 (connection.sendAudioFrame)
//          WebSocket受信 → Opusデコード → 再生 (AVAudioPlayerNode)
//
//  サーバー(server.js)側の音声フォーマットに合わせている:
//    SAMPLE_RATE = 48000, CHANNELS = 1, FRAME_SIZE = 960 (20ms @ 48kHz)
//
//  依存: alta/swift-opus (import Opus)
//        Xcode → File → Add Package Dependencies… → https://github.com/alta/swift-opus
//

import AVFoundation
import Opus

enum AudioPipelineError: Error {
    case formatCreationFailed
    case micPermissionDenied
}

@MainActor
final class AudioPipeline {

    // MARK: - Constants (server.js と一致させる)

    static let sampleRate: Double = 48000
    static let channels: AVAudioChannelCount = 1
    static let frameSize: AVAudioFrameCount = 960 // 20ms @ 48kHz

    // MARK: - Audio graph

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()

    private var opusEncoder: Opus.Encoder?
    private var opusDecoder: Opus.Decoder?

    /// Opusが要求する固定フォーマット (48kHz / mono / Float32)
    private var opusFormat: AVAudioFormat?

    /// マイクからの可変長バッファを 960サンプル単位に区切るためのアキュムレータ
    private var pendingSamples: [Float] = []

    /// エンコード済みフレームの送信先 (PTTConnectionManager.sendAudioFrame)
    var onEncodedFrame: ((Data) -> Void)?

    private(set) var isRunning = false
    private(set) var isSending = false

    // MARK: - Permission

    /// マイク権限をリクエストする。Info.plist に NSMicrophoneUsageDescription が必要。
    func requestMicPermission() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }

    // MARK: - Lifecycle

    /// オーディオセッション・エンジン・Opusエンコーダ/デコーダを準備して開始する。
    /// 接続(joined受信)後に呼び出す想定。
    func start() throws {
        guard !isRunning else { return }

        try configureAudioSession()

        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: Self.sampleRate,
            channels: Self.channels,
            interleaved: false
        ) else {
            throw AudioPipelineError.formatCreationFailed
        }
        self.opusFormat = format

        opusEncoder = try Opus.Encoder(format: format, application: .voip)
        opusDecoder = try Opus.Decoder(format: format, application: .voip)

        // --- 再生用ノード ---
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)

        // --- マイク入力タップ ---
        let inputNode = engine.inputNode
        // installTapはハードウェアフォーマット→指定フォーマットへの変換を行う。
        inputNode.installTap(onBus: 0, bufferSize: Self.frameSize, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            Task { @MainActor in
                self.handleMicBuffer(buffer)
            }
        }

        engine.prepare()
        try engine.start()
        playerNode.play()

        isRunning = true
        pendingSamples.removeAll()
    }

    func stop() {
        guard isRunning else { return }
        isSending = false
        engine.inputNode.removeTap(onBus: 0)
        playerNode.stop()
        engine.stop()
        isRunning = false
        pendingSamples.removeAll()
        opusEncoder = nil
        opusDecoder = nil
        opusFormat = nil
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setPreferredSampleRate(Self.sampleRate)
        try session.setActive(true)
    }

    // MARK: - Sending (PTTボタン押下中のみ true)

    func startSending() {
        isSending = true
        pendingSamples.removeAll()
    }

    func stopSending() {
        isSending = false
        pendingSamples.removeAll()
    }

    // MARK: - Mic → Opus エンコード

    private func handleMicBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isSending, let channelData = buffer.floatChannelData else { return }

        let frameLength = Int(buffer.frameLength)
        pendingSamples.append(contentsOf: UnsafeBufferPointer(start: channelData[0], count: frameLength))

        let frameSizeInt = Int(Self.frameSize)
        while pendingSamples.count >= frameSizeInt {
            let chunk = Array(pendingSamples.prefix(frameSizeInt))
            pendingSamples.removeFirst(frameSizeInt)
            encodeAndSend(chunk)
        }
    }

    private func encodeAndSend(_ samples: [Float]) {
        guard let encoder = opusEncoder, let format = opusFormat else { return }

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: Self.frameSize) else { return }
        pcmBuffer.frameLength = Self.frameSize
        samples.withUnsafeBufferPointer { ptr in
            pcmBuffer.floatChannelData?[0].update(from: ptr.baseAddress!, count: samples.count)
        }

        // Opusの最大パケットサイズは仕様上4000バイト程度で十分。
        var encodedData = Data(count: 4000)
        do {
            let byteCount = try encoder.encode(pcmBuffer, to: &encodedData)
            let trimmed = encodedData.prefix(byteCount)
            onEncodedFrame?(Data(trimmed))
        } catch {
            print("[AudioPipeline] encode error: \(error)")
        }
    }

    // MARK: - 受信フレーム → Opusデコード → 再生

    /// PTTConnectionManager.onAudioFrameReceived から呼び出す。
    func enqueueDecodedFrame(_ data: Data) {
        guard isRunning, let decoder = opusDecoder else { return }
        do {
            let buffer = try decoder.decode(data)
            playerNode.scheduleBuffer(buffer)
        } catch {
            print("[AudioPipeline] decode error: \(error)")
        }
    }
}
