//
//  PTTConnectionManager.swift
//  PTTClient
//
//  ptt-server (ws) との接続・JSON制御メッセージ・バイナリ(Opus)フレームの
//  送受信を一元管理する。Audio処理(エンコード/デコード)は現時点では未実装で、
//  バイナリフレームの受信フックだけ用意してある(Step Bで接続予定)。
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

    /// マイク取得・Opusエンコード/デコード・再生を担当するパイプライン (Step B)
    private let audio = AudioPipeline()

    override init() {
        super.init()
        self.session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)

        // エンコードされた自分の音声フレームをそのままサーバーへ送信する
        audio.onEncodedFrame = { [weak self] data in
            self?.sendAudioFrame(data)
        }
    }

    // MARK: - Public API

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

        Task {
            let granted = await audio.requestMicPermission()
            await MainActor.run {
                self.micPermissionDenied = !granted
                if !granted {
                    self.appendLog("マイク権限が許可されていません。設定アプリから許可してください")
                }
            }
        }

        let task = session.webSocketTask(with: url)
        webSocketTask = task
        task.resume()

        appendLog("WebSocket接続開始: \(urlString)")
        listen()

        // join はWebSocketのopen後に送る必要があるため、
        // didOpen デリゲートコールバックで送信する。
    }

    func disconnect() {
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
    func sendAudioFrame(_ data: Data) {
        guard let webSocketTask else { return }
        webSocketTask.send(.data(data)) { [weak self] error in
            if let error {
                Task { @MainActor in
                    self?.appendLog("音声フレーム送信エラー: \(error.localizedDescription)")
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
		do {
			let data = try message.encoded()
			guard let text = String(data: data, encoding: .utf8) else {
				appendLog("JSON文字列化エラー")
				return
			}
			webSocketTask.send(.string(text)) { [weak self] error in
				if let error {
					Task { @MainActor in
						self?.appendLog("送信エラー: \(error.localizedDescription)")
					}
				}
			}
		} catch {
			appendLog("JSONエンコードエラー: \(error.localizedDescription)")
		}
	}

    // MARK: - Receiving

    private func listen() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            Task { @MainActor in
                switch result {
                case .failure(let error):
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
            self.cleanupAfterDisconnect()
        }
    }
}
