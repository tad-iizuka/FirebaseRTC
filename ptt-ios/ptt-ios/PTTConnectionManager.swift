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
import AVFoundation
import Combine
import LiveKit
import AVFAudio

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
    @Published private(set) var isAcquiringTalk = false
    private var talkAttempt = 0
    private var talkOperationTask: Task<Void, Never>?
    /// [送話ロック連携] サーバー(routes/talk.js)がLiveKitのRoom Metadataに書き込む
    /// currentTalker(uid)。nilなら誰も発話ロックを保持していない。
    /// 自分以外のuidが入っている間、UI側はPTTボタンを無効化する。
    @Published private(set) var currentTalkerUid: String?
    /// [録音UI] サーバー(routes/recording.js)がLiveKitのRoom Metadataに書き込む
    /// recording.active。true の間は全参加者への開示バナーを表示する
    /// (Web版RecordingBar.vueと同じ「同意表示」の考え方)。
    @Published private(set) var isRecording = false
    /// 録音開始時刻(経過時間表示にのみ使う)。isRecordingがfalseの間は常にnil。
    @Published private(set) var recordingStartedAt: Date?

    // MARK: - Private

    private var room: Room?
    private var tokenServerURL = ""
    private var livekitURL = ""
    private var roomName = ""
    private var idTokenProvider: (() async throws -> String)?

    private struct TalkRequestContext {
        let roomName: String
        let tokenServerURL: String
        let idTokenProvider: (() async throws -> String)?
    }

    private var talkRequestContext: TalkRequestContext {
        TalkRequestContext(roomName: roomName, tokenServerURL: tokenServerURL,
                           idTokenProvider: idTokenProvider)
    }

    /// PTTボタンが現在物理的に押され続けているか。talk/start の応答待ち中に
    /// ボタンが離された場合を検知するために使う(Web版のpttHeldと同じ役割)。
    private var pttHeld = false
    /// startTalking() の呼び出しごとに増分し、古い呼び出しの結果(応答)を
    /// 無視するために使う(Web版のtalkRequestTokenと同じ役割)。
    private var talkRequestToken = 0
    /// 送話ロック保持中、失効(サーバー側TTL)前に延長し続けるための繰り返しタスク。
    private var talkHeartbeatTask: Task<Void, Never>?
    /// keep-aliveトラック(マイクをmuted状態でpublishし、Egressの
    /// 「最低1トラック」要件を満たすためのもの)を、この接続で既にpublish済みかどうか。
    /// connect()の開始時とdisconnect()でfalseにリセットする。
    private var keepAliveTrackPublished = false
    /// [音声エンジン事前ウォームアップ] AudioManager.shared.startLocalRecording()で
    /// ADMの録音を明示的に開始済みかどうか。disconnect()時にtrueであれば
    /// stopLocalRecording()で後始末する。同期処理はPTTAudioWorkerで実行する。
    private var localRecordingWarmupActive = false
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
        isRecording = false
        recordingStartedAt = nil
        keepAliveTrackPublished = false
        talkAttempt = 0

        Task {
            do {
                let token = try await fetchToken()
                appendLog(String(localized: "トークン取得成功"))

                let newRoom = Room(delegate: self)
                room = newRoom

                try await newRoom.connect(url: livekitURL, token: token)
                logCurrentAudioSession(context: "room_connected(before_warmup)")

                guard self.room === newRoom, case .connecting = status else { return }
                let preparationStarted = DispatchTime.now().uptimeNanoseconds
                let permissionGranted = await LiveKitSDK.ensureDeviceAccess(for: [.audio])
                appendLog("[PTTPrepare] microphone_permission=\(permissionGranted) elapsed_ms=\(Double(DispatchTime.now().uptimeNanoseconds - preparationStarted) / 1_000_000)")
                guard self.room === newRoom, case .connecting = status else { return }
                if permissionGranted {
                    let warmupStarted = DispatchTime.now().uptimeNanoseconds
                    appendLog("[PTTPrepare] warmup_begin")
                    do {
                        try await PTTAudioWorker.run { try AudioManager.shared.startLocalRecording() }
                        guard self.room === newRoom, case .connecting = status else {
                            try? await PTTAudioWorker.run { try AudioManager.shared.stopLocalRecording() }
                            return
                        }
                        localRecordingWarmupActive = true
                        appendLog("[PTTPrepare] warmup_complete elapsed_ms=\(Double(DispatchTime.now().uptimeNanoseconds - warmupStarted) / 1_000_000) engine=\(AudioManager.shared.isEngineRunning)")
                    } catch {
                        appendLog("[PTTPrepare] warmup_failed: \(error.localizedDescription)")
                    }
                    // Publish only a disabled track. Never enable a microphone before talk/start succeeds.
                    do {
                        let track = LocalAudioTrack.createTrack()
                        try await track.mute()
                        let publication = try await newRoom.localParticipant.publish(audioTrack: track)
                        keepAliveTrackPublished = publication.isMuted
                        appendLog("[PTTPrepare] muted_publish_complete muted=\(publication.isMuted)")
                    } catch {
                        appendLog("[PTTPrepare] muted_publish_failed: \(error.localizedDescription)")
                    }
                }
                logCurrentAudioSession(context: "room_connected(after_warmup)")
                appendLog("[PTTPrepare] complete elapsed_ms=\(Double(DispatchTime.now().uptimeNanoseconds - preparationStarted) / 1_000_000) engine=\(AudioManager.shared.isEngineRunning) muted_track=\(keepAliveTrackPublished)")

                guard self.room === newRoom, case .connecting = status else { return }

                // 接続時点で既に誰かが発話ロックを保持していた場合や、既に録音中だった場合に
                // 備え、room.metadataから初期状態を読み込む(メタデータ更新デリゲートは
                // 「変化した瞬間」しか呼ばれないため、接続前からの既存状態は別途拾う必要がある。
                // Web版と同じ理由)。
                applyMetadata(fromMetadataString: newRoom.metadata)

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
        status = .disconnected
        pttHeld = false
        isAcquiringTalk = false
        talkRequestToken += 1
        stopTalkHeartbeat()
        let previous = talkOperationTask
        let context = talkRequestContext
        talkOperationTask = Task {
            await previous?.value
            do {
                try await room.localParticipant.setMicrophone(enabled: false)
            } catch {
                await room.disconnect()
            }
            // 自分がロックを保持したまま切断すると、サーバー側はTTL(15秒)経過まで
            // 他の人をブロックし続けてしまうため、ベストエフォートで明示的に解放しておく。
            // (失敗しても実害はTTL経過まで待つだけなので、エラーは握りつぶしてよい)
            try? await self.talkRequest(.stop, context: context)

            await room.disconnect()
            self.room = nil
            participants.removeAll()
            isSending = false
            currentTalkerUid = nil
            isRecording = false
            recordingStartedAt = nil
            keepAliveTrackPublished = false
            if localRecordingWarmupActive {
                try? await PTTAudioWorker.run { try AudioManager.shared.stopLocalRecording() }
                localRecordingWarmupActive = false
            }
            status = .disconnected
            appendLog(String(localized: "切断しました"))
        }
    }

    /// PTTボタンが押された
    func startTalking() {
        // DragGesture.onChanged fires repeatedly while held. Accept one request per press.
        guard let room, case .connected = status, !pttHeld, !isSending else { return }
        guard currentTalkerUid == nil else { return }
        talkAttempt += 1
        let trace = PTTStartTrace(attempt: talkAttempt)
        trace.mark("button_event")
        trace.mark("ui_change_begin")
        pttHeld = true
        isAcquiringTalk = true
        trace.mark("ui_pending_complete")
        talkRequestToken += 1
        let myToken = talkRequestToken
        let previous = talkOperationTask
        let context = talkRequestContext

        talkOperationTask = Task {
            // Serialize start/stop so a delayed stop cannot release a newer press's lock.
            await previous?.value
            trace.mark("operation_queue_complete")
            guard self.room === room, self.pttHeld, myToken == self.talkRequestToken else {
                trace.mark("cancelled_before_acquire")
                return
            }
            do {
                trace.mark("lock_acquire_begin")
                try await talkRequest(.start, trace: trace, context: context)
                trace.mark("lock_acquire_complete")
            } catch {
                appendLog(String(format: NSLocalizedString("発話を開始できませんでした: %@", comment: "Talk start failure"), error.localizedDescription))
                if myToken == self.talkRequestToken {
                    // Keep the physical-press guard until release, including failures.
                    self.isAcquiringTalk = false
                }
                trace.mark("lock_acquire_failed_ui_complete")
                return
            }

            // stopTalking/disconnect has queued cleanup if the button was released.
            guard self.room === room, self.pttHeld, myToken == self.talkRequestToken else {
                trace.mark("released_before_microphone")
                return
            }
            do {
                trace.mark("microphone_enable_begin")
                guard let publication = try await room.localParticipant.setMicrophone(enabled: true) else {
                    throw LiveKitError(.invalidState, message: "Microphone publication missing")
                }
                trace.mark("microphone_enable_complete")
                // The SDK returns after publish/unmute. This is not a first RTP packet timestamp.
                trace.mark("audio_publish_or_unmute_complete muted=\(publication.isMuted)")
                guard self.room === room, self.pttHeld, myToken == self.talkRequestToken else {
                    // Keep the lock until audio is muted; queued stop performs release afterward.
                    try await room.localParticipant.setMicrophone(enabled: false)
                    trace.mark("released_during_enable_muted")
                    return
                }
                self.isSending = true
                self.isAcquiringTalk = false
                self.startTalkHeartbeat(context: context)
                trace.mark("ui_sending_complete")
            } catch {
                self.appendLog(String(format: NSLocalizedString("マイク有効化エラー: %@", comment: "Microphone enable error"), error.localizedDescription))
                if myToken == self.talkRequestToken {
                    // Keep the physical-press guard until release, including failures.
                    self.isAcquiringTalk = false
                }
                // Do not release a granted lock while a partially enabled mic might send.
                do {
                    try await room.localParticipant.setMicrophone(enabled: false)
                    try? await self.talkRequest(.stop, context: context)
                } catch {
                    await room.disconnect()
                }
                trace.mark("microphone_failed_cleanup_complete")
            }
        }
    }

    /// Queue microphone mute before lock release, including release during acquisition/publish.
    func stopTalking(forced: Bool = false) {
        pttHeld = false
        isAcquiringTalk = false
        talkRequestToken += 1
        guard let room else { return }
        stopTalkHeartbeat()
        isSending = false
        let previous = talkOperationTask
        let context = talkRequestContext
        talkOperationTask = Task {
            await previous?.value
            do {
                try await room.localParticipant.setMicrophone(enabled: false)
            } catch {
                self.appendLog(String(format: NSLocalizedString("マイク無効化エラー: %@", comment: "Microphone disable error"), error.localizedDescription))
                // Disconnect transport before allowing another participant to acquire the lock.
                await room.disconnect()
            }
            if !forced { try? await self.talkRequest(.stop, context: context) }
        }
    }

    // MARK: - 送話ロック(talk/start・heartbeat・stop)

    private enum TalkAction: String {
        case start
        case heartbeat
        case stop
    }

    private func startTalkHeartbeat(context: TalkRequestContext) {
        stopTalkHeartbeat()
        talkHeartbeatTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.talkLockHeartbeatNanoseconds)
                if Task.isCancelled { break }
                do {
                    try await self.talkRequest(.heartbeat, context: context)
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

    private func talkRequest(_ action: TalkAction, trace: PTTStartTrace? = nil, context: TalkRequestContext? = nil) async throws {
        let context = context ?? talkRequestContext
        guard let idTokenProvider = context.idTokenProvider else {
            throw TokenFetchError.serverError(statusCode: 401, message: String(localized: "サインインしていません"))
        }
        trace?.mark("firebase_auth_begin")
        let idToken = try await idTokenProvider()
        trace?.mark("firebase_auth_complete")

        let encodedRoomId = context.roomName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? context.roomName
        guard let url = URL(string: "\(context.tokenServerURL)/rooms/\(encodedRoomId)/talk/\(action.rawValue)") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        trace?.mark("firebase_appcheck_begin")
        if let appCheckToken = await PTTAppCheck.token() {
            request.setValue(appCheckToken, forHTTPHeaderField: "X-Firebase-AppCheck")
        }

        trace?.mark("firebase_appcheck_complete")
        request.setValue(trace?.id, forHTTPHeaderField: "X-PTT-Trace-ID")
        trace?.mark("talk_http_begin")
        let (data, response) = try await URLSession.shared.data(for: request)
        trace?.mark("talk_http_complete")
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard http.statusCode == 200 else {
            let serverMessage = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            throw TokenFetchError.serverError(statusCode: http.statusCode, message: serverMessage)
        }
    }

    /// LiveKitのRoom Metadata(JSON文字列)から現在の送話ロック保持者(currentTalker)と
    /// 録音状態(recording)を取り出して反映する。token-server/lib/roomMetadata.jsが書き込む
    /// `{ currentTalker, recording: { active, startedAt }, updatedAt }` の形式を前提にしている。
    /// パース失敗時は安全側(誰も発話中でない・録音していない)として扱う。
    ///
    /// [録音UI] startedAt はサーバーがUnix時刻(ms)として書き込む値。Web版の
    /// RecordingBar.vueと同じく、ここではUI表示用のDateに変換するだけで、
    /// 「録音中かどうか」の確定判定自体はサーバー(Room Metadata)に委ねる
    /// (token-server/routes/recording.js冒頭のコメント参照。/recording/start・
    /// /recording/stop のレスポンス単体では確定状態と見なさない)。
    private func applyMetadata(fromMetadataString metadata: String?) {
        guard
            let metadata,
            let data = metadata.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            currentTalkerUid = nil
            isRecording = false
            recordingStartedAt = nil
            return
        }

        currentTalkerUid = json["currentTalker"] as? String

        let recording = json["recording"] as? [String: Any]
        isRecording = recording?["active"] as? Bool ?? false
        if isRecording, let startedAtMs = recording?["startedAt"] as? Double {
            recordingStartedAt = Date(timeIntervalSince1970: startedAtMs / 1000)
        } else {
            recordingStartedAt = nil
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
        if let appCheckToken = await PTTAppCheck.token() {
            request.setValue(appCheckToken, forHTTPHeaderField: "X-Firebase-AppCheck")
        }

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

    /// [2026-07-30] 以前はlogLines(アプリ内のログ画面)にのみ追記しており、
    /// Xcodeコンソール/実機ログには出力されていなかった。診断ログ([診断]プレフィックス)を
    /// コンソール貼り付けだけで確認できるよう、print()も併せて行うようにした。
    private func appendLog(_ line: String) {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        let formatted = "[\(timestamp)] \(line)"
        logLines.append(formatted)
        if logLines.count > 200 {
            logLines.removeFirst(logLines.count - 200)
        }
        print("📋\(formatted)")
    }
}

// MARK: - RoomDelegate

extension PTTConnectionManager: RoomDelegate {

    nonisolated func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldConnectionState: ConnectionState) {
        Task { @MainActor in
            guard self.room === room else { return }
            self.appendLog(String(format: NSLocalizedString("接続状態: %@ → %@", comment: "Connection state changed"), String(describing: oldConnectionState), String(describing: connectionState)))
            if connectionState == .disconnected {
                self.pttHeld = false
                self.isAcquiringTalk = false
                self.talkRequestToken += 1
                self.stopTalkHeartbeat()
                self.participants.removeAll()
                self.isSending = false
                self.currentTalkerUid = nil
                self.isRecording = false
                self.recordingStartedAt = nil
                self.room = nil
                if self.localRecordingWarmupActive {
                    try? await PTTAudioWorker.run { try AudioManager.shared.stopLocalRecording() }
                    self.localRecordingWarmupActive = false
                }
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
            // 再接続の間に発話ロックや録音の状態が変わっている可能性があるため、
            // 最新のRoom Metadataから読み直しておく。
            self.applyMetadata(fromMetadataString: room.metadata)
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
            self.applyMetadata(fromMetadataString: metadata)
            self.appendLog(String(format: NSLocalizedString("[診断] メタデータ更新受信: currentTalker=%@ recording=%@", comment: "Metadata update diagnostic log"), self.currentTalkerUid ?? "null", self.isRecording ? "true" : "false"))
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
