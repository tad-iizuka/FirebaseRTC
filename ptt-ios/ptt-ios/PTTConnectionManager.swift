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
//  [送話ロック連携]
//  Web版(ptt-client/public/index.html)と同じく、token-server の
//  POST /rooms/:roomId/talk/start | /talk/heartbeat | /talk/stop
//  (token-server/routes/talk.js) を呼び出し、サーバー側のFirestoreトランザクションで
//  排他制御を強制する。クライアント側のUI抑制だけに頼らない。
//    - PTTボタン押下時: talk/start を呼び、成功して初めてマイクを有効化する。
//      他人が保持中なら409(talk_locked)が返るので、その場合は送話を開始しない。
//    - 送話中: LOCK_TTL_MS(サーバー側15秒)より十分短い間隔でtalk/heartbeatを呼び、
//      ロックの失効を防ぐ。heartbeatが失敗した場合(サーバー側でMAX_HOLD_MS超過等により
//      既にロックを失っている)は、強制的に送話を終了する。
//    - PTTボタン解放時 / ルーム退出時: talk/stop を呼びロックを明示的に解放する
//      (ベストエフォート。失敗してもサーバー側のTTL失効に任せられる)。
//    - サーバーが LiveKit Room Metadata に書き込む { currentTalker, ... } を
//      RoomDelegateのメタデータ更新経由で受け取り、他人が発話中の間はPTTボタンを
//      無効化する(ContentView側で currentTalkerUid を見て表示・入力可否を決める)。
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
    /// [送話ロック連携] サーバー(routes/talk.js)がLiveKitのRoom Metadataに書き込む
    /// currentTalker(uid)。nilなら誰も発話ロックを保持していない。
    /// 自分以外のuidが入っている間、UI側はPTTボタンを無効化する。
    @Published private(set) var currentTalkerUid: String?

    // MARK: - Private

    private var room: Room?
    private var tokenServerURL = ""
    private var livekitURL = ""
    private var roomName = ""
    private var idTokenProvider: (() async throws -> String)?

    /// PTTボタンが現在物理的に押され続けているか。talk/start の応答待ち中に
    /// ボタンが離された場合を検知するために使う(Web版のpttHeldと同じ役割)。
    private var pttHeld = false
    /// startTalking() の呼び出しごとに増分し、古い呼び出しの結果(応答)を
    /// 無視するために使う(Web版のtalkRequestTokenと同じ役割)。
    private var talkRequestToken = 0
    /// 送話ロック保持中、失効(サーバー側TTL)前に延長し続けるための繰り返しタスク。
    private var talkHeartbeatTask: Task<Void, Never>?
    /// サーバー側 LOCK_TTL_MS(15秒, token-server/routes/talk.js) より
    /// 十分短い間隔で延長する。Web版のTALK_LOCK_HEARTBEAT_MSと同じ値。
    private static let talkLockHeartbeatNanoseconds: UInt64 = 5_000_000_000

    // MARK: - Public API

    /// - Parameter idTokenProvider: token-server呼び出し時に都度呼ばれ、有効なFirebase ID Tokenを
    ///   返すクロージャ。呼び出し側(PTTAuthManager)が期限切れ検知・自動リフレッシュを担う。
    func connect(tokenServerURL: String, livekitURL: String, room roomName: String, idTokenProvider: @escaping () async throws -> String) {
        guard room == nil else {
            appendLog(String(localized: "すでに接続中/接続試行中です"))
            return
        }

        self.tokenServerURL = tokenServerURL
        self.livekitURL = livekitURL
        self.roomName = roomName
        self.idTokenProvider = idTokenProvider
        status = .connecting
        currentTalkerUid = nil

        Task {
            do {
                let token = try await fetchToken()
                appendLog(String(localized: "トークン取得成功"))

                let newRoom = Room(delegate: self)
                room = newRoom

                try await newRoom.connect(url: livekitURL, token: token)

                // PTTのため、接続直後はマイクを無効化しておく
                // (トラックは作られるが送信されない = ボタンを押すまで無音)
                try await newRoom.localParticipant.setMicrophone(enabled: false)

                // 接続時点で既に誰かが発話ロックを保持していた場合に備え、room.metadataから
                // 初期状態を読み込む(メタデータ更新デリゲートは「変化した瞬間」しか
                // 呼ばれないため、接続前からの既存状態は別途拾う必要がある。Web版と同じ理由)。
                updateCurrentTalker(fromMetadataString: newRoom.metadata)

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
                appendLog(String(format: NSLocalizedString("ルーム接続完了: room=%@", comment: "Room connected log"), roomName))
            } catch {
                appendLog(String(format: NSLocalizedString("接続エラー: %@", comment: "Connection error log"), error.localizedDescription))
                status = .error(error.localizedDescription)
                room = nil
            }
        }
    }

    func disconnect() {
        guard let room else { return }
        pttHeld = false
        talkRequestToken += 1
        stopTalkHeartbeat()
        Task {
            // 自分がロックを保持したまま切断すると、サーバー側はTTL(15秒)経過まで
            // 他の人をブロックし続けてしまうため、ベストエフォートで明示的に解放しておく。
            // (失敗しても実害はTTL経過まで待つだけなので、エラーは握りつぶしてよい)
            try? await self.talkRequest(.stop)

            await room.disconnect()
            self.room = nil
            participants.removeAll()
            isSending = false
            currentTalkerUid = nil
            status = .disconnected
            appendLog(String(localized: "切断しました"))
        }
    }

    /// PTTボタンが押された
    func startTalking() {
        guard let room, case .connected = status, !isSending else { return }
        // 他人が発話ロックを保持中の場合、UI側(ContentView)がボタンのヒットテストを
        // 無効化する想定だが、念のためここでも二重に弾く。
        guard currentTalkerUid == nil else { return }

        pttHeld = true
        talkRequestToken += 1
        let myToken = talkRequestToken

        Task {
            do {
                try await talkRequest(.start)
            } catch {
                // 他人が発話中(409 talk_locked)など。RoomMetadataの更新でほぼ同時に
                // ボタンも無効化されるはずだが、競合(ほぼ同時押下)によるレースは起こりうる。
                appendLog(String(format: NSLocalizedString("発話を開始できませんでした: %@", comment: "Talk start failure"), error.localizedDescription))
                if myToken == self.talkRequestToken { self.pttHeld = false }
                return
            }

            // [レース対策] talk/start の応答待ち(Cloud Runのコールドスタート等で
            // 1秒近くかかることがある)の間にボタンが離されていた場合、ここで送話を
            // 開始してしまうと「離したのに喋り続ける」状態になる。ロックは既に
            // 取得できてしまっているので、使わないままサーバー側に解放を伝える。
            guard self.pttHeld, myToken == self.talkRequestToken else {
                Task { try? await self.talkRequest(.stop) }
                return
            }

            do {
                try await room.localParticipant.setMicrophone(enabled: true)
                self.isSending = true
                self.startTalkHeartbeat()
            } catch {
                self.appendLog(String(format: NSLocalizedString("マイク有効化エラー: %@", comment: "Microphone enable error"), error.localizedDescription))
                Task { try? await self.talkRequest(.stop) }
            }
        }
    }

    /// PTTボタンが離された。
    /// - Parameter forced: heartbeat失敗などサーバー側で既にロックを失っている場合にtrue。
    ///   この場合 talk/stop の呼び出し自体は冪等なので害はないが、二重に呼ぶ必要はない。
    func stopTalking(forced: Bool = false) {
        pttHeld = false
        talkRequestToken += 1 // 進行中のstartTalkingがあれば、その結果を無視させる
        guard let room else { return }
        stopTalkHeartbeat()
        isSending = false

        Task {
            do {
                try await room.localParticipant.setMicrophone(enabled: false)
            } catch {
                self.appendLog(String(format: NSLocalizedString("マイク無効化エラー: %@", comment: "Microphone disable error"), error.localizedDescription))
            }
            if !forced {
                try? await self.talkRequest(.stop)
            }
        }
    }

    // MARK: - 送話ロック(talk/start・heartbeat・stop)

    private enum TalkAction: String {
        case start
        case heartbeat
        case stop
    }

    private func startTalkHeartbeat() {
        stopTalkHeartbeat()
        talkHeartbeatTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.talkLockHeartbeatNanoseconds)
                if Task.isCancelled { break }
                do {
                    try await self.talkRequest(.heartbeat)
                } catch {
                    // サーバー側で最大発話時間(MAX_HOLD_MS)を超えた等、ロックを失った
                    // 場合はここに来る。本来は次のRoomMetadata更新でもUIが追従するが、
                    // 念のため即座に強制的に送話を止める。
                    self.appendLog(String(format: NSLocalizedString("発話ロックの延長に失敗しました。送話を終了します: %@", comment: "Talk heartbeat failure"), error.localizedDescription))
                    self.stopTalking(forced: true)
                    break
                }
            }
        }
    }

    private func stopTalkHeartbeat() {
        talkHeartbeatTask?.cancel()
        talkHeartbeatTask = nil
    }

    private func talkRequest(_ action: TalkAction) async throws {
        guard let idTokenProvider else {
            throw TokenFetchError.serverError(statusCode: 401, message: String(localized: "サインインしていません"))
        }
        let idToken = try await idTokenProvider()

        let encodedRoomId = roomName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomName
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/talk/\(action.rawValue)") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard http.statusCode == 200 else {
            let serverMessage = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            throw TokenFetchError.serverError(statusCode: http.statusCode, message: serverMessage)
        }
    }

    /// LiveKitのRoom Metadata(JSON文字列)から currentTalker(uid) を取り出して反映する。
    /// token-server/lib/roomMetadata.js が書き込む `{ currentTalker, recording, updatedAt }`
    /// の形式を前提にしている。パース失敗時はnil(=誰も発話中でない)として扱う。
    private func updateCurrentTalker(fromMetadataString metadata: String?) {
        guard let metadata, let data = metadata.data(using: .utf8) else {
            currentTalkerUid = nil
            return
        }
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let talker = json["currentTalker"] as? String
        else {
            currentTalkerUid = nil
            return
        }
        currentTalkerUid = talker
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
                return message ?? String(format: NSLocalizedString("トークン取得に失敗しました (HTTP %d)", comment: "Token fetch failure"), statusCode)
            }
        }
    }

    private func fetchToken() async throws -> String {
        guard let idTokenProvider else {
            throw TokenFetchError.serverError(statusCode: 401, message: String(localized: "サインインしていません"))
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
            self.appendLog(String(format: NSLocalizedString("接続状態: %@ → %@", comment: "Connection state changed"), String(describing: oldConnectionState), String(describing: connectionState)))
            if connectionState == .disconnected {
                self.participants.removeAll()
                self.isSending = false
                self.currentTalkerUid = nil
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
            self.appendLog(String(format: NSLocalizedString("再接続を開始しました (mode=%@)", comment: "Reconnect started"), String(describing: reconnectMode)))
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
            self.appendLog(String(format: NSLocalizedString("再接続に成功しました (mode=%@)", comment: "Reconnect succeeded"), String(describing: reconnectMode)))
            if case .error = self.status {
                // 既にエラー表示中ならそのまま維持する
            } else {
                self.status = .connected(room: self.roomName)
            }
            // 再接続の間に発話ロックの状態が変わっている可能性があるため、
            // 最新のRoom Metadataから読み直しておく。
            self.updateCurrentTalker(fromMetadataString: room.metadata)
        }
    }

    /// 再接続を試みた末に失敗した場合や、サーバー側から切断された場合に呼ばれる。
    /// 実際のクリーンアップは `didUpdateConnectionState` 側の `.disconnected` 遷移で
    /// 行われる(こちらは主に理由をログに残すため)。
    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor in
            if let error {
                self.appendLog(String(format: NSLocalizedString("予期しない切断: %@", comment: "Unexpected disconnect"), error.localizedDescription))
            } else {
                self.appendLog(String(localized: "切断されました"))
            }
        }
    }

    nonisolated func room(_ room: Room, didFailToConnectWithError error: LiveKitError?) {
        Task { @MainActor in
            let reason = error?.localizedDescription ?? String(localized: "不明なエラー")
            self.appendLog(String(format: NSLocalizedString("接続失敗: %@", comment: "Connection failed log"), reason))
            self.status = .error(error?.localizedDescription ?? String(localized: "接続失敗"))
        }
    }

    /// [送話ロック連携] token-server(routes/talk.js → lib/roomMetadata.js)が
    /// RoomServiceClient.updateRoomMetadata() で書き込む
    /// `{ currentTalker, recording, updatedAt }` の変化を受け取る。
    ///
    /// [注意] このデリゲートメソッドの正確な名称・シグネチャはLiveKit Swift SDKの
    /// バージョンによって変わりうる(client-sdk-swift 2.15.1時点を想定)。導入時は
    /// 実際に依存させたバージョンのRoomDelegateの宣言と突き合わせて確認すること
    /// (ptt-android側のRoom.eventsに関する既存の注意書きと同じ理由)。
    nonisolated func room(_ room: Room, didUpdateMetadata metadata: String?) {
        Task { @MainActor in
            self.updateCurrentTalker(fromMetadataString: metadata)
            self.appendLog(String(format: NSLocalizedString("[診断] メタデータ更新受信: currentTalker=%@", comment: "Metadata update diagnostic log"), self.currentTalkerUid ?? "null"))
        }
    }

    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in
            let uid = participant.identity?.stringValue ?? "?"
            self.appendLog(String(format: NSLocalizedString("参加: %@", comment: "Participant joined log"), uid))
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
            self.appendLog(String(format: NSLocalizedString("退出: %@", comment: "Participant left log"), id))
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
