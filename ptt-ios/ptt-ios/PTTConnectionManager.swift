//
//  PTTConnectionManager.swift
//  PTTClient
//
//  [LiveKit移行]
//  以前はWebSocket直結 + AudioPipeline(AVAudioEngine + swift-opus)で
//  マイク取得・Opusエンコード/デコード・送受信をすべて自前実装していたが、
//  LiveKit Swift SDKの Room オブジェクトがこれらを全部代行するため、
//  このクラスは「トークン取得 → Room接続 → PTTのオン/オフ」の橋渡し役に縮小される。
//
//  送話中インジケーターは、以前は ptt_start/ptt_end の自前JSONメッセージだったが、
//  LiveKitの RoomDelegate が返す「トラックのmute/unmute」イベントをそのまま使う。
//

import Foundation
import Combine
import LiveKit

@MainActor
final class PTTConnectionManager: NSObject, ObservableObject {

    // MARK: - Published state (UIが監視する)

    @Published private(set) var status: ConnectionStatus = .disconnected
    /// [BAN対応] 以前は「現在送話中(unmute)のuid集合」のみを保持していたが、
    /// BANボタンの表示にはルーム内の全参加者(名前つき)が必要なため、
    /// uid -> 表示用情報 の辞書に置き換えた。ローカル参加者(自分)は含めない。
    @Published private(set) var participants: [String: PTTParticipantInfo] = [:]
    @Published private(set) var logLines: [String] = []
    @Published private(set) var isSending = false

    // MARK: - Private

    private var room: Room?
    private var tokenServerURL = ""
    private var livekitURL = ""
    private var roomName = ""
    private var idTokenProvider: (() async throws -> String)?

    // MARK: - Public API

    /// - Parameter idTokenProvider: token-server呼び出し時に都度呼ばれ、有効なFirebase ID Tokenを
    ///   返すクロージャ。呼び出し側(PTTAuthManager)が期限切れ検知・自動リフレッシュを担う。
    func connect(tokenServerURL: String, livekitURL: String, room roomName: String, idTokenProvider: @escaping () async throws -> String) {
        guard room == nil else {
            appendLog("すでに接続中/接続試行中です")
            return
        }

        self.tokenServerURL = tokenServerURL
        self.livekitURL = livekitURL
        self.roomName = roomName
        self.idTokenProvider = idTokenProvider
        status = .connecting

        Task {
            do {
                let token = try await fetchToken()
                appendLog("トークン取得成功")

                let newRoom = Room(delegate: self)
                room = newRoom

                try await newRoom.connect(url: livekitURL, token: token)

                // PTTのため、接続直後はマイクを無効化しておく
                // (トラックは作られるが送信されない = ボタンを押すまで無音)
                try await newRoom.localParticipant.setMicrophone(enabled: false)

                // 接続時点ですでに他の参加者がいる場合、参加後に発火するイベントだけでは
                // 拾えないため room.remoteParticipants から初期状態を取り込む。
                // TrackPublication.isMuted (LiveKit Swift SDK) はサブクラスの
                // RemoteTrackPublicationがサーバー通知(metadata)由来のmute状態を
                // 反映するため、track未購読の時点でも信頼できる。
                // 音声トラック自体が存在しない(まだ一度もマイクをpublishしていない)
                // 参加者のみ、安全側に倒して「未送話」扱いにしておく。
                var initialParticipants: [String: PTTParticipantInfo] = [:]
                for remote in newRoom.remoteParticipants.values {
                    let uid = remote.identity?.stringValue ?? "?"
                    let audioPub = remote.trackPublications.values.first(where: { $0.kind == .audio })
                    let isMuted = audioPub?.isMuted ?? true
                    initialParticipants[uid] = PTTParticipantInfo(uid: uid, name: remote.name ?? uid, isMuted: isMuted)
                }
                participants = initialParticipants

                status = .connected(room: roomName)
                appendLog("ルーム接続完了: room=\(roomName)")
            } catch {
                appendLog("接続エラー: \(error.localizedDescription)")
                status = .error(error.localizedDescription)
                room = nil
            }
        }
    }

    func disconnect() {
        guard let room else { return }
        Task {
            await room.disconnect()
            self.room = nil
            participants.removeAll()
            isSending = false
            status = .disconnected
            appendLog("切断しました")
        }
    }

    /// PTTボタンが押された
    func startTalking() {
        guard let room, case .connected = status, !isSending else { return }
        isSending = true
        Task {
            do {
                try await room.localParticipant.setMicrophone(enabled: true)
            } catch {
                appendLog("マイク有効化エラー: \(error.localizedDescription)")
                isSending = false
            }
        }
    }

    /// PTTボタンが離された
    func stopTalking() {
        guard let room, isSending else { return }
        isSending = false
        Task {
            do {
                try await room.localParticipant.setMicrophone(enabled: false)
            } catch {
                appendLog("マイク無効化エラー: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - トークン取得

    private struct TokenResponse: Decodable {
        let token: String
    }

    /// token-serverが返すエラーレスポンス `{ "error": "..." }` をデコードするための型。
    /// これを拾うことで、以前のように "NSURLErrorDomain error -1011" という不親切な
    /// エラーではなく、「このルームのメンバーではありません」等の具体的な理由を表示できる。
    private struct ServerErrorResponse: Decodable {
        let error: String?
    }

    private enum TokenFetchError: LocalizedError {
        case serverError(statusCode: Int, message: String?)

        var errorDescription: String? {
            switch self {
            case let .serverError(statusCode, message):
                return message ?? "トークン取得に失敗しました (HTTP \(statusCode))"
            }
        }
    }

    private func fetchToken() async throws -> String {
        guard let idTokenProvider else {
            throw TokenFetchError.serverError(statusCode: 401, message: "サインインしていません")
        }
        let idToken = try await idTokenProvider()

        guard var components = URLComponents(string: "\(tokenServerURL)/token") else {
            throw URLError(.badURL)
        }
        components.queryItems = [
            URLQueryItem(name: "room", value: roomName),
        ]
        guard let url = components.url else { throw URLError(.badURL) }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard http.statusCode == 200 else {
            let serverMessage = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            throw TokenFetchError.serverError(statusCode: http.statusCode, message: serverMessage)
        }
        return try JSONDecoder().decode(TokenResponse.self, from: data).token
    }

    // MARK: - Log

    private func appendLog(_ line: String) {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        logLines.append("[\(timestamp)] \(line)")
        if logLines.count > 200 {
            logLines.removeFirst(logLines.count - 200)
        }
    }
}

// MARK: - RoomDelegate

extension PTTConnectionManager: RoomDelegate {

    nonisolated func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldConnectionState: ConnectionState) {
        Task { @MainActor in
            self.appendLog("接続状態: \(oldConnectionState) → \(connectionState)")
            if connectionState == .disconnected {
                self.participants.removeAll()
                self.isSending = false
                self.room = nil
                if case .error = self.status {
                    // エラーによる切断は表示を残す
                } else {
                    self.status = .disconnected
                }
            }
        }
    }

    /// 再接続開始。SDKドキュメント上、こちらは quick(ICE再起動)/full どちらのモードでも
    /// 確実に呼ばれる (`didUpdateConnectionState`はquickモードでは呼ばれないため代用不可)。
    /// ネットワーク瞬断からの自動復旧中であることをUIに反映するためのフック。
    nonisolated func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) {
        Task { @MainActor in
            self.appendLog("再接続を開始しました (mode=\(reconnectMode))")
            if case .error = self.status {
                // 既にエラー表示中ならそのまま維持する
            } else {
                self.status = .reconnecting(room: self.roomName)
            }
        }
    }

    /// 再接続成功。
    nonisolated func room(_ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode) {
        Task { @MainActor in
            self.appendLog("再接続に成功しました (mode=\(reconnectMode))")
            if case .error = self.status {
                // 既にエラー表示中ならそのまま維持する
            } else {
                self.status = .connected(room: self.roomName)
            }
        }
    }

    /// 再接続を試みた末に失敗した場合や、サーバー側から切断された場合に呼ばれる。
    /// 実際のクリーンアップは `didUpdateConnectionState` 側の `.disconnected` 遷移で
    /// 行われる(こちらは主に理由をログに残すため)。
    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor in
            if let error {
                self.appendLog("予期しない切断: \(error.localizedDescription)")
            } else {
                self.appendLog("切断されました")
            }
        }
    }

    nonisolated func room(_ room: Room, didFailToConnectWithError error: LiveKitError?) {
        Task { @MainActor in
            self.appendLog("接続失敗: \(error?.localizedDescription ?? "不明なエラー")")
            self.status = .error(error?.localizedDescription ?? "接続失敗")
        }
    }

    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in
            let uid = participant.identity?.stringValue ?? "?"
            self.appendLog("参加: \(uid)")
            // participantDidConnect発火時点で既にトラック情報(publish済みか)を
            // 持っている場合があるため、初期同期時と同じくisMutedを実際の値から取得する。
            // 音声トラックがまだ無い参加者は安全側に倒して「未送話」扱いにする。
            let audioPub = participant.trackPublications.values.first(where: { $0.kind == .audio })
            let isMuted = audioPub?.isMuted ?? true
            self.participants[uid] = PTTParticipantInfo(uid: uid, name: participant.name ?? uid, isMuted: isMuted)
        }
    }

    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor in
            let id = participant.identity?.stringValue ?? "?"
            self.appendLog("退出: \(id)")
            self.participants.removeValue(forKey: id)
        }
    }

    /// 送話中表示: 音声トラックのmute/unmuteをそのまま参加者の送話状態の出し入れに使う。
    /// 以前の talker_start/talker_end に相当。
    nonisolated func room(_ room: Room, participant: Participant, trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool) {
        guard trackPublication.kind == .audio, let identity = participant.identity?.stringValue else { return }
        Task { @MainActor in
            self.participants[identity]?.isMuted = isMuted
        }
    }
}
