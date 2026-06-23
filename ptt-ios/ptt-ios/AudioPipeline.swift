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
//  [修正点]
//  - [FIX A] inputNode 直タップ + floatChannelData 直接読み取り方式。
//    AVAudioSession で 48kHz を指定しているため nativeFormat も 48kHz/mono/Float32 になり、
//    AVAudioConverter 不要でサンプルをそのまま使える。
//    フォーマットが異なる場合のフォールバックとして AVAudioConverter を保持するが、
//    通常は使われない。
//
//  - [FIX B] オーディオスレッド上でエンコードまで完結。NSLock で共有状態を保護。
//    UI コールバック (onStatus/onError/onMicBufferReceived) は DispatchQueue.main.async 経由。
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

    /// フォールバック用コンバータ（nativeFormat が Float32 以外の場合のみ使用）
    private var audioConverter: AVAudioConverter?

    private let audioLock = NSLock()
    private var _pendingSamples: [Float] = []
    private var _isSending: Bool = false

    var onEncodedFrame: ((Data) -> Void)?
    var onError: ((String) -> Void)?
    var onStatus: ((String) -> Void)?
    var onMicBufferReceived: ((Int) -> Void)?

    private(set) var isRunning = false

    var isSending: Bool {
        audioLock.withLock { _isSending }
    }

    // MARK: - Permission

    func requestMicPermission() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }

    var currentMicPermissionStatus: AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .audio)
    }

    // MARK: - Lifecycle

    func start() throws {
        guard !isRunning else {
            onStatus?("start(): すでに起動済みのためスキップ")
            return
        }

        let permission = currentMicPermissionStatus
        guard permission == .authorized else {
            throw AudioPipelineError.micPermissionDenied
        }
        onStatus?("start(): マイク権限OK")

        try configureAudioSession()
        let session = AVAudioSession.sharedInstance()
        onStatus?("start(): AudioSession設定完了 sampleRate=\(session.sampleRate) inputAvailable=\(session.isInputAvailable)")

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
        onStatus?("start(): Opusエンコーダ/デコーダ作成完了")

        // --- オーディオグラフ ---
        // inputNode → (直タップ) → handleMicBuffer → encodeAndSend → onEncodedFrame
        // playerNode → mainMixerNode → スピーカー

        engine.attach(playerNode)

        let inputNode = engine.inputNode
        let nativeFormat = inputNode.outputFormat(forBus: 0)
        onStatus?("start(): nativeFormat sampleRate=\(nativeFormat.sampleRate) ch=\(nativeFormat.channelCount) fmt=\(nativeFormat.commonFormat.rawValue)")

        guard nativeFormat.sampleRate > 0, nativeFormat.channelCount > 0 else {
            onStatus?("start(): 警告 nativeFormatが無効")
            throw AudioPipelineError.formatCreationFailed
        }

        engine.connect(playerNode, to: engine.mainMixerNode, format: format)

        // nativeFormat が opusFormat と異なる場合のみコンバータを用意
        if nativeFormat != format {
            audioConverter = AVAudioConverter(from: nativeFormat, to: format)
            onStatus?("start(): AVAudioConverter作成 \(Int(nativeFormat.sampleRate))Hz/\(nativeFormat.channelCount)ch/fmt\(nativeFormat.commonFormat.rawValue) → 48000Hz/1ch/Float32")
        } else {
            onStatus?("start(): nativeFormat == opusFormat、変換不要")
        }

        // inputNode に直接タップ
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: nativeFormat) { [weak self] buffer, _ in
            guard let self else { return }
            self.handleMicBuffer(buffer)
        }
        onStatus?("start(): installTap完了（inputNode直タップ）")

        engine.prepare()
        do {
            try engine.start()
        } catch {
            onStatus?("start(): engine.start()失敗 \(error.localizedDescription)")
            throw error
        }
        playerNode.play()
        onStatus?("start(): engine.start()成功 isRunning=\(engine.isRunning)")

        isRunning = true
        audioLock.withLock {
            _pendingSamples.removeAll()
            _isSending = false
        }
    }

    func stop() {
        guard isRunning else { return }
        audioLock.withLock {
            _isSending = false
            _pendingSamples.removeAll()
        }
        engine.inputNode.removeTap(onBus: 0)
        playerNode.stop()
        engine.stop()
        engine.detach(playerNode)
        isRunning = false
        opusEncoder = nil
        opusDecoder = nil
        opusFormat = nil
        audioConverter = nil
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setPreferredSampleRate(Self.sampleRate)
        try session.setActive(true)
    }

    // MARK: - Sending

    func startSending() {
        audioLock.withLock {
            _pendingSamples.removeAll()
            _isSending = true
        }
    }

    func stopSending() {
        audioLock.withLock {
            _isSending = false
            _pendingSamples.removeAll()
        }
    }

    // MARK: - Mic → Opus エンコード（オーディオスレッドで完結）

    private func handleMicBuffer(_ buffer: AVAudioPCMBuffer) {
        let frameLen = Int(buffer.frameLength)
        DispatchQueue.main.async { [weak self] in
            self?.onMicBufferReceived?(frameLen)
        }

        guard audioLock.withLock({ _isSending }) else { return }

        if let channelData = buffer.floatChannelData {
            // nativeFormat が Float32 → そのまま使う（変換コストゼロ）
            guard frameLen > 0 else { return }
            let samples = [Float](UnsafeBufferPointer(start: channelData[0], count: frameLen))
            enqueue(samples)
        } else {
            // nativeFormat が Float32 以外（Int16 等）→ AVAudioConverter でフォールバック変換
            convertAndEnqueue(buffer)
        }
    }

    /// Float32 サンプル列を pendingSamples に追加し、960サンプルずつエンコード
    private func enqueue(_ samples: [Float]) {
        audioLock.withLock { _pendingSamples.append(contentsOf: samples) }

        let frameSizeInt = Int(Self.frameSize)
        var encodeCount = 0  // ← 追加
        while true {
            let chunk: [Float] = audioLock.withLock {
                guard _pendingSamples.count >= frameSizeInt else { return [] }
                let c = Array(_pendingSamples.prefix(frameSizeInt))
                _pendingSamples.removeFirst(frameSizeInt)
                return c
            }
            guard chunk.count == frameSizeInt else { break }
            encodeAndSend(chunk)
        }
		// ← 追加
		if encodeCount != 5 {
			let msg = "enqueue: samples=\(samples.count) encodeCount=\(encodeCount) pending=\(audioLock.withLock { _pendingSamples.count })"
			DispatchQueue.main.async { [weak self] in self?.onStatus?(msg) }
		}
    }

    /// フォールバック: AVAudioConverter で Float32 に変換してから enqueue
    private func convertAndEnqueue(_ buffer: AVAudioPCMBuffer) {
        guard let converter = audioConverter, let format = opusFormat else { return }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let outCount = AVAudioFrameCount(Double(buffer.frameLength) * ratio)
        guard outCount > 0,
              let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: outCount) else { return }

        var err: NSError?
        var fed = false
        converter.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return buffer
        }
        guard err == nil, let ch = out.floatChannelData, out.frameLength > 0 else {
            if let e = err {
                let msg = "convert error: \(e.localizedDescription)"
                DispatchQueue.main.async { [weak self] in self?.onError?(msg) }
            }
            return
        }
        let samples = [Float](UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
        enqueue(samples)
    }

    private var lastEncodeLogAt: Date = .distantPast

    private func encodeAndSend(_ samples: [Float]) {
        guard let encoder = opusEncoder, let format = opusFormat else { return }

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: Self.frameSize) else {
            DispatchQueue.main.async { [weak self] in self?.onError?("PCMバッファ作成失敗") }
            return
        }
        pcmBuffer.frameLength = Self.frameSize
        samples.withUnsafeBufferPointer { ptr in
            pcmBuffer.floatChannelData?[0].update(from: ptr.baseAddress!, count: samples.count)
        }

        var encodedData = Data(count: 4000)
        do {
            let byteCount = try encoder.encode(pcmBuffer, to: &encodedData)
            let trimmed = Data(encodedData.prefix(byteCount))

            let now = Date()
            if now.timeIntervalSince(lastEncodeLogAt) > 1.0 {
                lastEncodeLogAt = now
                let hex = trimmed.prefix(4).map { String(format: "%02x", $0) }.joined(separator: " ")
                let msg = "encode ok: bytes=\(byteCount) head=[\(hex)]"
                DispatchQueue.main.async { [weak self] in self?.onStatus?(msg) }
            }

            onEncodedFrame?(trimmed)
        } catch {
            let msg = "encode error: \(error)"
            DispatchQueue.main.async { [weak self] in self?.onError?(msg) }
        }
    }

    // MARK: - 受信フレーム → Opusデコード → 再生

    func enqueueDecodedFrame(_ data: Data) {
        guard isRunning, let decoder = opusDecoder, let expectedFormat = opusFormat else { return }
        do {
            let buffer = try decoder.decode(data)
            if buffer.format.sampleRate != expectedFormat.sampleRate ||
               buffer.format.channelCount != expectedFormat.channelCount {
                onError?("decode format mismatch: got \(buffer.format.sampleRate)Hz/\(buffer.format.channelCount)ch")
            }
            playerNode.scheduleBuffer(buffer)
        } catch {
            onError?("decode error: \(error)")
        }
    }
}
