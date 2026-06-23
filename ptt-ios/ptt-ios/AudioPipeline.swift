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
//  - encode/decodeエラーがこれまでprint()のみでUIに見えなかったため、
//    onError クロージャを追加し、PTTConnectionManager側のログに出せるようにした。
//  - マイクタップでバッファが実際に届いているか確認できるよう、
//    onMicBufferReceived (デバッグ用フレーム数通知) を追加した。
//    本番で不要になったら削除してよい。
//

import AVFoundation
import Opus

enum AudioPipelineError: Error {
    case formatCreationFailed
    case micPermissionDenied
}

/// [修正] `Result`の失敗型には`Error`に準拠した型が必要なため、
/// 単純な文字列メッセージを保持するためのエラー型を用意した。
/// （`String`はそのままでは`Error`に準拠していないため`Result<[Float], String>`はコンパイルエラーになる）
private struct ConversionError: Error {
    let message: String
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

    /// [修正] エンコード/デコード/セッション関連のエラーを呼び出し元に通知する。
    /// 今まではprint()のみでUIログに出ていなかったため追加。
    var onError: ((String) -> Void)?

    /// [修正・デバッグ用] 起動シーケンスの進行状況を通知する。
    /// 「どこまで進んでどこで止まったか」を特定するための一時的な診断用フック。
    /// 原因特定後は不要になれば削除してよい。
    var onStatus: ((String) -> Void)?

    /// [修正・デバッグ用] マイクタップで実際に届いたバッファのフレーム数を通知する。
    /// 「マイクから音が来ているか」自体を確認するためのフック。
    /// 原因特定後は呼び出し元での購読を外せばログは出なくなる。
    var onMicBufferReceived: ((Int) -> Void)?

    private(set) var isRunning = false
    private(set) var isSending = false

    // MARK: - Permission

    /// マイク権限をリクエストする。Info.plist に NSMicrophoneUsageDescription が必要。
    func requestMicPermission() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }

    /// 現在のマイク権限状態を同期的に確認する（リクエストはしない）。
    var currentMicPermissionStatus: AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .audio)
    }

    // MARK: - Lifecycle

    /// オーディオセッション・エンジン・Opusエンコーダ/デコーダを準備して開始する。
    /// 接続(joined受信)後に呼び出す想定。
    ///
    /// [修正] マイク権限が未許可(notDetermined/denied/restricted)の場合は
    /// ここで明示的にエラーをthrowするようにした。
    /// 以前は権限が未確定のままengine.start()まで進み、
    /// 「エラーは出ないが音が一切送られない」という分かりづらい状態になっていた。
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
        onStatus?("start(): AudioSession設定完了 (sampleRate=\(AVAudioSession.sharedInstance().sampleRate), inputAvailable=\(AVAudioSession.sharedInstance().isInputAvailable))")

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

        // --- 再生用ノード ---
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)

        // --- マイク入力タップ ---
        let inputNode = engine.inputNode

        // [修正・重要] これまでは installTap に明示的なフォーマット(48kHz/mono/Float32)を
        // 渡していたが、ハードウェアのネイティブフォーマットと異なる場合、
        // AVAudioEngine内部で行われるサンプルレート変換が小さいバッファサイズ(960=20ms)と
        // 組み合わさるとノイズ・クラックル（「ビリビリ」音）の原因になることがある。
        // → タップはハードウェアのネイティブフォーマットのまま受け取り、
        //   48kHz/mono/Float32への変換は自前の AVAudioConverter で明示的に行う方式に変更した。
        let nativeFormat = inputNode.outputFormat(forBus: 0)
        onStatus?("start(): nativeFormat sampleRate=\(nativeFormat.sampleRate) channels=\(nativeFormat.channelCount) commonFormat=\(nativeFormat.commonFormat.rawValue)")

        guard nativeFormat.sampleRate > 0, nativeFormat.channelCount > 0 else {
            // [修正] ネイティブフォーマットが取得できていない(0)場合、ここで気づけるようにする。
            // これまではこのケースで AVAudioConverter の初期化に失敗し、
            // formatCreationFailed として原因が分かりにくいまま落ちていた。
            onStatus?("start(): 警告 nativeFormatが無効です(sampleRate=0またはchannels=0) — 入力ハードウェアが利用できない可能性")
            throw AudioPipelineError.formatCreationFailed
        }

        guard let converter = AVAudioConverter(from: nativeFormat, to: format) else {
            throw AudioPipelineError.formatCreationFailed
        }
        onStatus?("start(): AVAudioConverter作成完了")

        // バッファサイズはネイティブフォーマット側で適切な値を使う。
        // 小さすぎるとコンバータの呼び出し回数が増えて逆に不安定になりやすいため、
        // 960よりやや大きめの値(1024)を指定する（あくまで目安値で、実際のサイズは
        // OSが調整することがある＝これまでのログでも4800フレームで来ていた）。
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: nativeFormat) { [weak self] buffer, _ in
            guard let self else { return }
            // 変換処理自体はMainActorに依存しないstaticメソッドとして実装しており、
            // オーディオスレッド上で同期的に（バッファが再利用される前に）完了させる。
            let result = Self.convert(buffer, using: converter, to: format)
            Task { @MainActor in
                switch result {
                case .success(let samples):
                    self.handleMicBuffer(samples)
                case .failure(let convError):
                    self.onError?(convError.message)
                }
            }
        }
        onStatus?("start(): installTap完了")

        engine.prepare()
        do {
            try engine.start()
        } catch {
            onStatus?("start(): engine.start()失敗 \(error.localizedDescription)")
            throw error
        }
        playerNode.play()
        onStatus?("start(): engine.start()成功 / isRunning=\(engine.isRunning)")

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

    /// [修正] ネイティブフォーマットのバッファを48kHz/mono/Float32へ変換する。
    /// `AudioPipeline`は`@MainActor`だが、このメソッドはオーディオスレッドから
    /// 直接（同期的に）呼び出す必要があるため`nonisolated static`にしている。
    /// self（MainActor状態）には一切触れず、引数として渡された`converter`と
    /// `targetFormat`のみを使うため、actor隔離の問題なく呼び出せる。
    ///
    /// バッファ(`buffer`)は呼び出し元のタップコールバック内で渡されたものをそのまま使うが、
    /// ここで変換・コピーまで同期的に完了させてから返すため、
    /// 呼び出し元でTaskにホップする前にデータは安全な状態になっている。
    private nonisolated static func convert(
        _ buffer: AVAudioPCMBuffer,
        using converter: AVAudioConverter,
        to targetFormat: AVAudioFormat
    ) -> Result<[Float], ConversionError> {
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let outputFrameCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16

        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outputFrameCapacity) else {
            return .failure(ConversionError(message: "input convert: 出力バッファ作成失敗"))
        }

        var conversionError: NSError?
        var consumed = false
        let status = converter.convert(to: outBuffer, error: &conversionError) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return buffer
        }

        guard status != .error else {
            return .failure(ConversionError(message: "input convert error: \(conversionError?.localizedDescription ?? "unknown")"))
        }
        guard let channelData = outBuffer.floatChannelData else {
            return .failure(ConversionError(message: "input convert: floatChannelDataが取得できません"))
        }

        let frameLength = Int(outBuffer.frameLength)
        let samples = [Float](UnsafeBufferPointer(start: channelData[0], count: frameLength))
        return .success(samples)
    }

    /// [修正] 引数を AVAudioPCMBuffer から、変換済みの [Float] に変更。
    /// （バッファの再利用によるデータ破損＝音割れ・ノイズを防ぐため）
    private func handleMicBuffer(_ samples: [Float]) {
        // [修正] isSendingの値に関わらず、タップ自体が動いているかを確認できるようにする。
        // (本当にここに来ているかどうかをまず確認するためのデバッグ通知)
        onMicBufferReceived?(samples.count)

        guard isSending else { return }

        pendingSamples.append(contentsOf: samples)

        let frameSizeInt = Int(Self.frameSize)
        while pendingSamples.count >= frameSizeInt {
            let chunk = Array(pendingSamples.prefix(frameSizeInt))
            pendingSamples.removeFirst(frameSizeInt)
            encodeAndSend(chunk)
        }
    }

    /// [修正・デバッグ用] エンコード成功ログのスロットリング用
    private var lastEncodeLogAt: Date = .distantPast

    private func encodeAndSend(_ samples: [Float]) {
        guard let encoder = opusEncoder, let format = opusFormat else {
            onError?("エンコーダ未初期化のため送信できません")
            return
        }

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: Self.frameSize) else {
            onError?("PCMバッファ作成失敗")
            return
        }
        pcmBuffer.frameLength = Self.frameSize
        samples.withUnsafeBufferPointer { ptr in
            pcmBuffer.floatChannelData?[0].update(from: ptr.baseAddress!, count: samples.count)
        }

        // Opusの最大パケットサイズは仕様上4000バイト程度で十分。
        var encodedData = Data(count: 4000)
        do {
            let byteCount = try encoder.encode(pcmBuffer, to: &encodedData)
            let trimmed = Data(encodedData.prefix(byteCount))

            // [修正・デバッグ用] 実際に送信しようとしているOpusパケットのサイズと
            // 先頭バイトを確認できるようにする（壊れたパケットを送っていないか確認用）。
            // 1秒に1回程度に間引く。
            let now = Date()
            if now.timeIntervalSince(lastEncodeLogAt) > 1.0 {
                lastEncodeLogAt = now
                let hexPrefix = trimmed.prefix(4).map { String(format: "%02x", $0) }.joined(separator: " ")
                onStatus?("encode ok: bytes=\(byteCount) head=[\(hexPrefix)]")
            }

            onEncodedFrame?(trimmed)
        } catch {
            // [修正] print()のみだったため、UIログに出るようにonErrorへ通知する。
            onError?("encode error: \(error)")
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
            // [修正] print()のみだったため、UIログに出るようにonErrorへ通知する。
            onError?("decode error: \(error)")
        }
    }
}
