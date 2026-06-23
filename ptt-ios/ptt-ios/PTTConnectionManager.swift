//
//  PTTConnectionManager.swift
//  PTTClient
//
//  ptt-server (ws) との接続・JSON制御メッセージ・バイナリ(Opus)フレームの
//  送受信を一元管理する。
//
//  [修正点]
//  1. マイク権限のリクエストが connect() 内で投げっぱなしの Task になっていて、
//     joined受信→AudioPipeline.start() のタイミングと権限確定のタイミングが
//     競合する可能性があったため、権限取得が完了する「まで」待ってから
//     WebSocket接続を開始するように変更した。
//  2. AudioPipeline.onError / onMicBufferReceived を購読し、
//     これまでXcodeコンソールにしか出ていなかったエンコード/デコードエラーや
//     マイクバッファの到達状況をオンスクリーンログに出すようにした。
//  3. 切断後に処理中だった receive() が「ソケットが閉じられた」エラーで
//     返ってくることで重複して出ていた「受信エラー」ログを抑制した。
//

import Foundation
import Combine

@MainActor
final class PTTConnectionManager: NSObject, ObservableObject {

    // MARK: - Published state (UIが監視する)

    @Published private(set) var status: ConnectionStatus = .disconnected
    @Published private(set) var members: [String] = []
    @Published private(set) var talkers: Set<String> = []
    @Published private(set) var logLines: [String] = []
    @Published private(set) var isSending = false
    @Published private(set) var micPermissionDenied = false

    // MARK: - Private

    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession!
    private var clientId: String?
    private var roomId: String?

    /// [修正] 切断処理がすでに走っているかどうか。
    /// receive() の失敗コールバックがclose後にも発火するため、
    /// 二重ログを抑制する目的で使う。
    private var isDisconnecting = false

    /// マイク取得・Opusエンコード/デコード・再生を担当するパイプライン (Step B)
    private let audio = AudioPipeline()

    /// [修正・デバッグ用] マイクバッファ到達ログのスロットリング用
    private var lastMicBufferLogAt: Date = .distantPast

    override init() {
        super.init()
        self.session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)

        // エンコードされた自分の音声フレームをそのままサーバーへ送信する
        audio.onEncodedFrame = { [weak self] data in
            self?.sendAudioFrame(data)
        }

        // [修正・デバッグ用] start()内の進行状況をログに出す。
        // 「どこで止まっているか」を特定するための一時的な診断ログ。
        audio.onStatus = { [weak self] message in
            self?.appendLog("AudioPipeline status: \(message)")
        }

        // [修正] AudioPipeline内のエラーをオンスクリーンログに反映する
        audio.onError = { [weak self] message in
            self?.appendLog("AudioPipeline: \(message)")
        }

        // [修正・デバッグ用] マイクから実際にバッファが届いているか確認する。
        // 1秒に1回程度に間引いてログに出す（連投を避けるため）。
        audio.onMicBufferReceived = { [weak self] frameCount in
            guard let self else { return }
            let now = Date()
            if now.timeIntervalSince(self.lastMicBufferLogAt) > 1.0 {
                self.lastMicBufferLogAt = now
                self.appendLog("mic buffer received: frames=\(frameCount), sending=\(self.audio.isSending)")
            }
        }
    }

    // MARK: - Public API

    /// [修正] マイク権限の確定を待ってからWebSocket接続を開始するようにした。
    /// 以前は Task { await audio.requestMicPermission() } を投げっぱなしにしていたため、
    /// 権限確定前に joined → audio.start() が走るケースがあった。
    func connect(urlString: String, room: String, clientId: String) {
        guard let url = URL(string: urlString) else {
            appendLog("不正なURL: \(urlString)")
            status = .error("不正なURL")
            return
        }
        guard webSocketTask == nil else {
            appendLog("すでに接続中/接続試行中です")
            return
        }

        self.clientId = clientId
        self.roomId = room
        status = .connecting
        isDisconnecting = false

        Task {
            let granted = await audio.requestMicPermission()
            await MainActor.run {
                self.micPermissionDenied = !granted
            }
            guard granted else {
                await MainActor.run {
                    self.appendLog("マイク権限が許可されていません。設定アプリから許可してください")
                    self.status = .error("マイク権限が許可されていません")
                }
                return
            }
            await MainActor.run {
                self.startWebSocket(url: url)
            }
        }
    }

    private func startWebSocket(url: URL) {
        let task = session.webSocketTask(with: url)
        webSocketTask = task
        task.resume()

        appendLog("WebSocket接続開始: \(url.absoluteString)")
        listen()

        // join はWebSocketのopen後に送る必要があるため、
        // didOpen デリゲートコールバックで送信する。
    }

    func disconnect() {
        isDisconnecting = true
        stopTalking()
        send(.leave)
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        audio.stop()
        cleanupAfterDisconnect()
    }

    /// PTTボタンが押された
    func startTalking() {
        guard !isSending else { return }
        guard case .connected = status else { return }
        isSending = true
        audio.startSending()
        send(.pttStart)
    }

    /// PTTボタンが離された
    func stopTalking() {
        guard isSending else { return }
        isSending = false
        audio.stopSending()
        send(.pttEnd)
    }

    /// Opusエンコード済みバイナリフレームを送信する (Step Bで使用)
    /// [修正・デバッグ用] 音声フレーム送信ログのスロットリング用
    private var lastAudioSendLogAt: Date = .distantPast

    func sendAudioFrame(_ data: Data) {
        guard let webSocketTask else { return }
        // [修正] disconnect中/close後はsendしない（"Socket is not connected"の温床）
        guard !isDisconnecting else { return }

        // [修正・デバッグ用] 実際にWebSocket送信を試みているタイミングと
        // WebSocketTaskの状態を確認できるようにする（1秒に1回程度に間引く）。
        let now = Date()
        if now.timeIntervalSince(lastAudioSendLogAt) > 1.0 {
            lastAudioSendLogAt = now
            appendLog("音声フレーム送信試行: bytes=\(data.count) wsState=\(webSocketTask.state.rawValue)")
        }

        webSocketTask.send(.data(data)) { [weak self] error in
            if let error {
                Task { @MainActor in
                    guard let self, !self.isDisconnecting else { return }
                    self.appendLog("音声フレーム送信エラー: \(error.localizedDescription)")
                }
            }
        }
    }

    // MARK: - Sending JSON

	private func send(_ message: OutgoingMessage) {
		guard let webSocketTask else {
			appendLog("未接続のため送信できません: \(message)")
			return
		}
		// [修正] 切断処理中は黙って無視する（直前にleaveを送ったあとの
		// 重複送信などで "Socket is not connected" が出るのを防ぐ）
		guard !isDisconnecting || isLeaveMessage(message) else {
			return
		}
		do {
			let data = try message.encoded()
			guard let text = String(data: data, encoding: .utf8) else {
				appendLog("JSON文字列化エラー")
				return
			}
			webSocketTask.send(.string(text)) { [weak self] error in
				if let error {
					Task { @MainActor in
						guard let self, !self.isDisconnecting else { return }
						self.appendLog("送信エラー: \(error.localizedDescription)")
					}
				}
			}
		} catch {
			appendLog("JSONエンコードエラー: \(error.localizedDescription)")
		}
	}

	private func isLeaveMessage(_ message: OutgoingMessage) -> Bool {
		if case .leave = message { return true }
		return false
	}

    // MARK: - Receiving

    private func listen() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            Task { @MainActor in
                switch result {
                case .failure(let error):
                    // [修正] 切断処理中に発生する失敗は「いつものこと」なので
                    // ログに出さず黙って終わる（didCloseで既に後処理済みのため）。
                    guard !self.isDisconnecting else { return }
                    self.appendLog("受信エラー: \(error.localizedDescription)")
                    self.status = .error(error.localizedDescription)
                    self.cleanupAfterDisconnect()
                    return

                case .success(let message):
                    switch message {
                    case .data(let data):
                        // バイナリ = Opusフレーム → デコードして再生
                        self.audio.enqueueDecodedFrame(data)
                    case .string(let text):
                        if let data = text.data(using: .utf8) {
                            self.handleControlMessage(data)
                        }
                    @unknown default:
                        break
                    }
                    // 次の受信を継続してリッスン
                    self.listen()
                }
            }
        }
    }

    private func handleControlMessage(_ data: Data) {
        guard let msg = IncomingMessage.parse(data) else {
            appendLog("不明な制御メッセージを解析できませんでした")
            return
        }

        switch msg {
        case .joined(let room, let clientId, let members, let audioFormat):
            self.members = members
            status = .connected(room: room)
            appendLog("参加完了: room=\(room) clientId=\(clientId) members=\(members) audioFormat=\(audioFormat)")
            do {
                try audio.start()
            } catch AudioPipelineError.micPermissionDenied {
                // [修正] 権限未許可を明示的にハンドリングしてわかりやすいログを出す
                appendLog("オーディオパイプライン開始エラー: マイク権限が許可されていません")
                micPermissionDenied = true
            } catch {
                appendLog("オーディオパイプライン開始エラー: \(error.localizedDescription)")
            }

        case .memberJoined(let clientId):
            if !members.contains(clientId) { members.append(clientId) }
            appendLog("参加: \(clientId)")

        case .memberLeft(let clientId):
            members.removeAll { $0 == clientId }
            talkers.remove(clientId)
            appendLog("退出: \(clientId)")

        case .talkerStart(let clientId):
            talkers.insert(clientId)

        case .talkerEnd(let clientId):
            talkers.remove(clientId)

        case .error(let message):
            appendLog("サーバエラー: \(message)")

        case .unknown(let raw):
            appendLog("未対応メッセージ: \(raw)")
        }
    }

    // MARK: - Cleanup

    private func cleanupAfterDisconnect() {
        webSocketTask = nil
        members = []
        talkers = []
        isSending = false
        audio.stop()
        if case .error = status {
            // エラーで切断した場合はエラー表示を残す
        } else {
            status = .disconnected
        }
        isDisconnecting = false
    }

    private func appendLog(_ line: String) {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        logLines.append("[\(timestamp)] \(line)")
        if logLines.count > 200 {
            logLines.removeFirst(logLines.count - 200)
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension PTTConnectionManager: URLSessionWebSocketDelegate {

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        Task { @MainActor in
            guard let room = self.roomId, let clientId = self.clientId else { return }
            self.appendLog("WebSocket接続完了。joinを送信します")
            self.send(.join(room: room, clientId: clientId))
        }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        Task { @MainActor in
            self.appendLog("WebSocket切断 (code=\(closeCode.rawValue))")
            self.isDisconnecting = true
            self.cleanupAfterDisconnect()
        }
    }
}
