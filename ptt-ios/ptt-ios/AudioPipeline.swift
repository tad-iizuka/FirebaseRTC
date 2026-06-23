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
//  - [FIX A] AVAudioConverter 方式を廃止。
//    AVAudioConverter をオーディオスレッドから毎フレーム呼び出す方式では、
//    コンバータ内部のフィルタ状態が「ストリームが途切れた」とみなされリセットされるため
//    フレーム境界でクリックノイズ（ビリビリ音）が発生していた。
//    → AVAudioMixerNode を中継ノードとして挟み、フォーマット変換を
//      AVAudioEngine 内部（エンジンのレンダースレッド上）に完全に委譲する方式に変更。
//      これによりコンバータのストリーム状態が途切れることなく維持される。
//
//  - [FIX B] Task { @MainActor in } によるフレーム順序の非保証を排除。
//    オーディオスレッドから Task を生成する方式ではフレームの到着順が保証されず、
//    pendingSamples への追記順がずれてビリビリ音になっていた。
//    → タップコールバック内で pendingSamples への追記とエンコードをすべて
//      オーディオスレッド上で同期的に完了させる方式に変更。
//      isSending / pendingSamples は専用の NSLock で保護する。
//
//  - [従来からの修正点を継承]
//    encode/decodeエラーを onError クロージャで通知。
//    onMicBufferReceived デバッグフック。
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

    // [FIX A] inputNode → mixerNode(48kHz/mono/Float32) → tap の経路で
    // フォーマット変換をエンジン内部に委譲するための中継ミキサー。
    // AVAudioEngine はノード間の接続フォーマット差を内部で自動変換する。
    private let inputMixerNode = AVAudioMixerNode()

    private var opusEncoder: Opus.Encoder?
    private var opusDecoder: Opus.Decoder?

    /// Opusが要求する固定フォーマット (48kHz / mono / Float32)
    private var opusFormat: AVAudioFormat?

    // [FIX B] pendingSamples と isSending はオーディオスレッドからアクセスするため NSLock で保護する。
    private let audioLock = NSLock()
    private var _pendingSamples: [Float] = []
    private var _isSending: Bool = false

    /// エンコード済みフレームの送信先 (PTTConnectionManager.sendAudioFrame)
    /// オーディオスレッドから呼ばれることに注意。スレッドセーフな実装が必要。
    var onEncodedFrame: ((Data) -> Void)?

    /// エンコード/デコード/セッション関連のエラーを呼び出し元に通知する。
    var onError: ((String) -> Void)?

    /// 起動シーケンスの進行状況を通知する（デバッグ用）。
    var onStatus: ((String) -> Void)?

    /// マイクタップで実際に届いたバッファのフレーム数を通知する（デバッグ用）。
    var onMicBufferReceived: ((Int) -> Void)?

    private(set) var isRunning = false

    var isSending: Bool {
        get { audioLock.withLock { _isSending } }
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

        // --- オーディオグラフの構築 ---
        //
        // [FIX A] 接続トポロジー:
        //   inputNode (nativeFormat) → inputMixerNode (opusFormat=48kHz/mono/Float32)
        //                                     ↓ tap（ここで受け取るデータは常に48kHz/mono/Float32）
        //   playerNode (opusFormat) → mainMixerNode
        //
        // inputNode → inputMixerNode の接続時にフォーマット差があれば
        // AVAudioEngine が内部でサンプルレート変換・チャンネルダウンミックスを行う。
        // コンバータのストリーム状態はエンジンが管理するため、フレーム境界での
        // 状態リセット問題が発生しない。

        engine.attach(inputMixerNode)
        engine.attach(playerNode)

        let inputNode = engine.inputNode
        let nativeFormat = inputNode.outputFormat(forBus: 0)
        onStatus?("start(): nativeFormat sampleRate=\(nativeFormat.sampleRate) ch=\(nativeFormat.channelCount)")

        guard nativeFormat.sampleRate > 0, nativeFormat.channelCount > 0 else {
            onStatus?("start(): 警告 nativeFormatが無効 — 入力ハードウェアが利用できない可能性")
            throw AudioPipelineError.formatCreationFailed
        }

        // inputNode → inputMixerNode: nativeFormat → opusFormat への変換をエンジンに委譲
        engine.connect(inputNode, to: inputMixerNode, format: nativeFormat)
        // inputMixerNode → mainMixerNode: タップ後の出力先（音量ゼロにして再生しない）
        engine.connect(inputMixerNode, to: engine.mainMixerNode, format: format)
        inputMixerNode.outputVolume = 0.0 // マイク入力を再生側に漏らさない

        // playerNode → mainMixerNode: 受信音声の再生
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)

        // [FIX A] タップは inputMixerNode の出力（すでに48kHz/mono/Float32に変換済み）に設置する。
        // [FIX B] コールバック内でエンコードまで同期完了させ、Task生成を排除する。
        inputMixerNode.installTap(onBus: 0, bufferSize: Self.frameSize, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            // このクロージャはオーディオスレッドで呼ばれる。
            // MainActor状態（onMicBufferReceived等）へのアクセスは最小限に抑え、
            // 安全のためすべての処理をここで完結させる。
            self.handleMicBuffer(buffer)
        }
        onStatus?("start(): installTap完了（inputMixerNode、format=48kHz/mono/Float32）")

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
        inputMixerNode.removeTap(onBus: 0)
        playerNode.stop()
        engine.stop()
        engine.detach(inputMixerNode)
        engine.detach(playerNode)
        isRunning = false
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

    // [FIX B] このメソッドはオーディオスレッドから直接呼ばれる。
    // MainActor へのホップは行わない。
    // opusEncoder は start()/stop() でのみ書き換えられ、isRunning が true の間は
    // 不変のため、ここでの読み取りは安全。
    private func handleMicBuffer(_ buffer: AVAudioPCMBuffer) {
        // デバッグ通知はスレッドをまたぐが、onMicBufferReceived の実装側で
        // DispatchQueue.main.async 等を使うこと。
        onMicBufferReceived?(Int(buffer.frameLength))

        guard audioLock.withLock({ _isSending }) else { return }
        guard let channelData = buffer.floatChannelData else { return }

        let frameLength = Int(buffer.frameLength)
        let newSamples = [Float](UnsafeBufferPointer(start: channelData[0], count: frameLength))

        audioLock.withLock { _pendingSamples.append(contentsOf: newSamples) }

        let frameSizeInt = Int(Self.frameSize)
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
    }

    // [修正・デバッグ用] エンコード成功ログのスロットリング用
    private var lastEncodeLogAt: Date = .distantPast

    // オーディオスレッドから呼ばれる。
    private func encodeAndSend(_ samples: [Float]) {
        guard let encoder = opusEncoder, let format = opusFormat else { return }

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: Self.frameSize) else {
            onError?("PCMバッファ作成失敗")
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
                let hexPrefix = trimmed.prefix(4).map { String(format: "%02x", $0) }.joined(separator: " ")
                onStatus?("encode ok: bytes=\(byteCount) head=[\(hexPrefix)]")
            }

            onEncodedFrame?(trimmed)
        } catch {
            onError?("encode error: \(error)")
        }
    }

    // MARK: - 受信フレーム → Opusデコード → 再生

    func enqueueDecodedFrame(_ data: Data) {
        guard isRunning, let decoder = opusDecoder, let expectedFormat = opusFormat else { return }
        do {
            let buffer = try decoder.decode(data)
            // デコード出力フォーマットの検証（デバッグ用）
            if buffer.format.sampleRate != expectedFormat.sampleRate ||
               buffer.format.channelCount != expectedFormat.channelCount {
                onError?("decode format mismatch: got \(buffer.format.sampleRate)Hz/\(buffer.format.channelCount)ch expected \(expectedFormat.sampleRate)Hz/\(expectedFormat.channelCount)ch")
            }
            playerNode.scheduleBuffer(buffer)
        } catch {
            onError?("decode error: \(error)")
        }
    }
}
