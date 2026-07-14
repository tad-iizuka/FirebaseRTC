//
//  ContentView.swift
//  ptt-ios
//
//  [LiveKit移行 + Firebase Auth対応 + 招待制ルーム対応 + Phase5テキストチャット + 送話ロック連携 + オンボーディング]
//  Web版(ptt-client/public/index.html)と同等のUI:
//  Googleサインイン → ルーム作成/招待コード参加 → PTTボタン → 送話中リスト → チャット → ログ
//  クライアントIDの手入力は廃止(token-serverは常にFirebase ID Token由来のuidを
//  identityとして使うため、クライアントが自己申告する値は元々使われていなかった)。
//  ルームIDの直接入力による接続も廃止し、token-serverのinvite_only設計
//  (POST /rooms でルーム作成、POST /rooms/:roomId/join で招待コード検証)に合わせた。
//
//  [送話ロック連携]
//  PTTConnectionManager が token-server の /talk/start・/talk/heartbeat・/talk/stop
//  (token-server/routes/talk.js)を呼び出し、サーバー側で排他制御を強制する。
//  このView側は connection.currentTalkerUid を見て、自分以外が発話ロックを
//  保持している間はPTTボタンを無効化し、「誰が話しているか」を表示するだけに留める
//  (実際のロック取得/延長/解放ロジックはすべてPTTConnectionManagerに集約されている)。
//
//  [オンボーディング]
//  Web版(ptt-client/src/App.vue)と同じ設計判断: onboarding.hasCompletedOnboarding が
//  falseの間は、サインイン状態に関わらずスワイプ形式の紹介画面(PTTOnboardingView)を
//  最優先で表示する。完了/スキップすると通常のサインイン〜ルームフローに切り替わる。
//

import SwiftUI
import FirebaseAuth

struct ContentView: View {

    @StateObject private var auth = PTTAuthManager()
    @StateObject private var roomManager = PTTRoomManager()
    @StateObject private var savedRooms = PTTSavedRoomsStore()
    @StateObject private var connection = PTTConnectionManager()
    @StateObject private var chat = PTTChatStore()
    @StateObject private var ban = PTTBanStore()
    @StateObject private var onboarding = PTTOnboardingStore()

    @State private var tokenServerURL: String = "https://ptt-token-server-rnn4fqay3a-an.a.run.app"
    @State private var livekitURL: String = "wss://ubunifu-talk-wy19xst3.livekit.cloud"
    @State private var joinRoomId: String = ""
    @State private var joinInviteCode: String = ""
    @State private var chatInputText: String = ""

    /// 実際に作成/参加してLiveKit接続に進んだルームID。nilの間はルーム選択画面を表示する。
    @State private var activeRoomId: String?
    /// 自分がルーム作成者(owner)の場合のみセットされる、参加者への共有用招待コード。
    @State private var currentInviteCode: String?
    /// [BAN対応] BANボタン押下時の確認ダイアログの対象。
    @State private var banTarget: PTTParticipantInfo?
    /// [BAN対応] 自分がBANされてルームを追い出された直後に表示する通知文言。
    @State private var banNotice: String?

    var body: some View {
        Group {
            if !onboarding.hasCompletedOnboarding {
                // [オンボーディング] 初回起動時はサインイン前でもこの画面を最優先で表示する。
                PTTOnboardingView(onComplete: { onboarding.complete() })
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        header
                        if auth.currentUser == nil {
                            authSection
                        } else if activeRoomId != nil {
                            statusRow
                            inviteBox
                            voiceSection
                            talkArea
                            talkerSection
                            chatSection
                            logSection
                        } else {
                            roomSelectionSection
                        }
                    }
                }
            }
        }
        .background(.pttBackground)
        .foregroundColor(.pttText)
        .onChange(of: auth.currentUser?.uid, initial: true) { _, newUid in
            savedRooms.load(forUid: newUid)
        }
        // [BAN対応] 自分がBANされたことをリアルタイム検知したら、即座にルームから退出する。
        // BAN自体の強制力はLiveKit側の即時キック(サーバー)が担うため、ここは表示のための補助。
        .onChange(of: ban.isBanned) { _, isBanned in
            guard isBanned else { return }
            banNotice = "このルームから排除されました"
            leaveRoom()
        }
        .alert(
            "BANしますか?",
            isPresented: Binding(
                get: { banTarget != nil },
                set: { if !$0 { banTarget = nil } }
            ),
            presenting: banTarget
        ) { target in
            Button("BANする", role: .destructive) { confirmBan(target) }
            Button("キャンセル", role: .cancel) { banTarget = nil }
        } message: { target in
            Text("\(target.name) をこのルームからBANしますか?\nこの操作は取り消せません。")
        }
    }

    // MARK: - Auth

    /// 未サインイン時の画面。Web版のauthSectionに相当。
    private var authSection: some View {
        VStack(spacing: 14) {
            Button {
                Task { await auth.signInWithGoogle() }
            } label: {
                Text(auth.isSigningIn ? "サインイン中..." : "Googleでサインイン")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
            }
            .buttonStyle(.plain)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .stroke(Color.pttAccent, lineWidth: 1)
            )
            .foregroundColor(.pttAccent)
            .disabled(auth.isSigningIn)

            if let message = auth.lastErrorMessage {
                Text(message)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttDanger)
            }
        }
        .padding(14)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("PTT CLIENT")
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundColor(.pttMuted)
            Spacer()
            if auth.currentUser != nil {
                Text(auth.displayName ?? "")
                    .font(.system(size: 12, design: .monospaced))
                    .lineLimit(1)
                Button("サインアウト") {
                    leaveRoom()
                    auth.signOut()
                }
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.pttMuted)
                .padding(.leading, 8)
            }
            Spacer()
            Text(channelLabel)
                .font(.system(size: 13, design: .monospaced))
        }
        .padding(14)
    }

    private var channelLabel: String {
        switch connection.status {
        case .connected(let room): return "room: \(room)"
        case .reconnecting(let room): return "room: \(room)"
        default: return "未接続"
        }
    }

    // MARK: - Status

    private var statusRow: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            Text(statusText)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(.pttMuted)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 10)
    }

    private var statusColor: Color {
        switch connection.status {
        case .connected: return .pttLive
        case .reconnecting: return .pttWarning // 黄色系: 再接続試行中であることを目立たせる
        case .error: return .pttDanger
        default: return .pttMuted
        }
    }

    private var statusText: String {
        switch connection.status {
        case .disconnected: return "サーバ未接続"
        case .connecting: return "接続中..."
        case .connected(let room): return "接続中 (room=\(room))"
        case .reconnecting(let room): return "再接続中... (room=\(room))"
        case .error(let message): return "エラー: \(message)"
        }
    }

    // MARK: - Room selection (作成 / 招待コードで参加)

    /// サインイン済み・未入室時の画面。Web版のroomSectionに相当。
    private var roomSelectionSection: some View {
        VStack(spacing: 10) {
            if let banNotice {
                Text(banNotice)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.pttDanger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            field(label: "トークンサーバーURL", text: $tokenServerURL)
            field(label: "LiveKit URL (wss://)", text: $livekitURL)

            Button(action: handleCreateRoom) {
                Text(roomManager.isWorking ? "作成中..." : "新しいルームを作成する")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
            }
            .buttonStyle(.plain)
            .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color.pttAccent, lineWidth: 1))
            .foregroundColor(.pttAccent)
            .disabled(roomManager.isWorking)

            Text("— または —")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.pttMuted)
                .frame(maxWidth: .infinity)

            HStack(spacing: 10) {
                field(label: "ルームID", text: $joinRoomId, placeholder: "招待された側が入力")
                field(label: "招待コード", text: $joinInviteCode, placeholder: "8文字のコード")
            }
            Button(action: handleJoinRoom) {
                Text(roomManager.isWorking ? "参加中..." : "招待コードで参加する")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
            }
            .buttonStyle(.plain)
            .overlay(RoundedRectangle(cornerRadius: 2).stroke(.pttLine, lineWidth: 1))
            .foregroundColor(.pttMuted)
            .disabled(roomManager.isWorking)

            if let message = roomManager.lastErrorMessage {
                Text(message)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttDanger)
            }

            if !savedRooms.rooms.isEmpty {
                Text("— 最近使ったルーム —")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.pttMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)

                VStack(spacing: 6) {
                    ForEach(savedRooms.rooms) { saved in
                        savedRoomRow(saved)
                    }
                }
            }
        }
        .padding(14)
    }

    private func savedRoomRow(_ saved: PTTSavedRoomsStore.SavedRoom) -> some View {
        HStack(spacing: 8) {
            Button {
                rejoinSavedRoom(saved)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(saved.label)
                        .font(.system(size: 12, design: .monospaced))
                        .lineLimit(1)
                    Text("(\(saved.roomId))")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
            }
            .buttonStyle(.plain)
            .background(.pttPanel.opacity(0.6))

            Button("削除") {
                savedRooms.remove(roomId: saved.roomId)
            }
            .font(.system(size: 11, design: .monospaced))
            .foregroundColor(.pttMuted)
        }
    }

    /// 招待コード表示。自分がowner(ルーム作成者)の場合のみ表示される。
    @ViewBuilder
    private var inviteBox: some View {
        if let code = currentInviteCode, let roomId = activeRoomId {
            VStack(alignment: .leading, spacing: 6) {
                Text("このルームの招待コード(参加者に共有してください):")
                    .font(.system(size: 12, design: .monospaced))
                Text(code)
                    .font(.system(size: 18, weight: .bold, design: .monospaced))
                    .foregroundColor(.pttAccent)
                Text("ルームID: \(roomId)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.pttMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4]))
                    .foregroundColor(.pttAccent)
            )
            .padding(14)
        }
    }

    /// 入室後: 退出ボタン。Web版のleaveRoomBtnに相当。
    private var voiceSection: some View {
        Button(action: leaveRoom) {
            Text("ルームを退出する")
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
        }
        .buttonStyle(.plain)
        .overlay(RoundedRectangle(cornerRadius: 2).stroke(.pttLine, lineWidth: 1))
        .foregroundColor(.pttMuted)
        .padding(14)
    }

    private func field(label: String, text: Binding<String>, placeholder: String = "") -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.pttMuted)
            TextField(placeholder, text: text)
                .font(.system(size: 14, design: .monospaced))
                .padding(8)
                .background(.pttPanel.opacity(0.6))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
    }

    private var isConnected: Bool {
        if case .connected = connection.status { return true }
        return false
    }

    /// [送話ロック連携] 自分以外が発話ロックを保持しているか。
    /// trueの間はPTTボタンを無効化し、「誰が話しているか」を表示する。
    private var someoneElseIsTalking: Bool {
        guard let talkerUid = connection.currentTalkerUid else { return false }
        return talkerUid != auth.currentUser?.uid
    }

    /// 現在発話ロックを保持している相手の表示名(自分以外の場合のみ意味を持つ)。
    private var currentTalkerName: String {
        guard let talkerUid = connection.currentTalkerUid else { return "" }
        return connection.participants[talkerUid]?.name ?? talkerUid
    }

    private func handleCreateRoom() {
        roomManager.clearError()
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                let (roomId, inviteCode) = try await roomManager.createRoom(tokenServerURL: tokenServerURL, idToken: idToken)
                currentInviteCode = inviteCode
                savedRooms.upsert(roomId: roomId, label: "自分が作成したルーム", inviteCode: inviteCode)
                enterRoom(roomId)
            } catch {
                // roomManager.lastErrorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    private func handleJoinRoom() {
        let roomId = joinRoomId.trimmingCharacters(in: .whitespacesAndNewlines)
        let inviteCode = joinInviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !roomId.isEmpty, !inviteCode.isEmpty else { return }
        roomManager.clearError()
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await roomManager.joinRoom(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, inviteCode: inviteCode)
                currentInviteCode = inviteCode // 参加者自身が入力したコードをそのまま保持する(以前はnilで潰していたため招待コード欄が表示されなかった)
                savedRooms.upsert(roomId: roomId, label: "招待コードで参加したルーム", inviteCode: inviteCode)
                enterRoom(roomId)
            } catch {
                // roomManager.lastErrorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    /// 保存済みのルームをタップした場合: 招待コード検証(/rooms/:id/join)は経由せず、
    /// 既にメンバーである前提でそのままトークン取得〜接続に進む。
    /// (メンバーでなくなっていた場合 = BAN等 は /token が403を返すのでconnection側のエラー表示に出る)
    private func rejoinSavedRoom(_ saved: PTTSavedRoomsStore.SavedRoom) {
        currentInviteCode = saved.inviteCode
        enterRoom(saved.roomId)
    }

    private func enterRoom(_ roomId: String) {
        banNotice = nil
        activeRoomId = roomId
        chat.start(roomId: roomId)
        ban.start(roomId: roomId, uid: auth.currentUser?.uid ?? "")
        connection.connect(
            tokenServerURL: tokenServerURL,
            livekitURL: livekitURL,
            room: roomId,
            idTokenProvider: { try await auth.fetchIDToken() }
        )
    }

    private func leaveRoom() {
        if connection.status != .disconnected { connection.disconnect() }
        chat.stop()
        ban.stop()
        activeRoomId = nil
        currentInviteCode = nil
        joinRoomId = ""
        joinInviteCode = ""
        chatInputText = ""
    }

    /// [BAN対応] BAN確認ダイアログで「BANする」を選んだ際に呼ばれる。
    private func confirmBan(_ target: PTTParticipantInfo) {
        banTarget = nil
        guard let roomId = activeRoomId else { return }
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await ban.banParticipant(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, targetUid: target.uid)
            } catch {
                // ban.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    // MARK: - Talk area (PTT button)

    /// [送話ロック連携] 自分以外が発話ロックを保持している間はボタンのヒットテストを無効化し、
    /// 「誰が話しているか」を表示する。実際のロック取得/解放は
    /// connection.startTalking()/stopTalking() が担う(このView自身はサーバーを呼ばない)。
    private var talkArea: some View {
        let canTalk = isConnected && !someoneElseIsTalking
        return VStack(spacing: 14) {
            Circle()
                .strokeBorder(connection.isSending ? Color.pttAccent : .pttLine, lineWidth: 2)
                .background(Circle().fill(.pttPanel.opacity(0.6)))
                .frame(width: 150, height: 150)
                .overlay(
                    Text(talkAreaLabel)
                        .font(.system(size: 13, design: .monospaced))
                        .multilineTextAlignment(.center)
                        .foregroundColor(connection.isSending ? .pttAccent : .pttMuted)
                        .padding(.horizontal, 10)
                )
                .scaleEffect(connection.isSending ? 0.97 : 1.0)
                .opacity(canTalk ? 1.0 : 0.3)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in connection.startTalking() }
                        .onEnded { _ in connection.stopTalking() }
                )
                .allowsHitTesting(canTalk)

            Text("ボタンを押している間だけ音声が送信されます")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.pttMuted)
        }
        .padding(.vertical, 24)
    }

    private var talkAreaLabel: String {
        if connection.isSending { return "送話中" }
        if someoneElseIsTalking { return "\(currentTalkerName) が送話中" }
        return "押して送話"
    }

    // MARK: - Talkers / Participants

    /// [BAN対応] Web版の「参加者(緑=送話中)」に相当。以前は送話中の相手だけを
    /// チップで表示していたが、BAN対象を選べるよう全参加者を一覧表示するように変更した。
    private var talkerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("参加者(緑=送話中)")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.pttMuted)

            if connection.participants.isEmpty {
                Text("— なし —")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttMuted)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(sortedParticipants) { info in
                        participantRow(info)
                    }
                }
            }
        }
        .padding(14)
    }

    private var sortedParticipants: [PTTParticipantInfo] {
        connection.participants.values.sorted { $0.name < $1.name }
    }

    /// owner/moderatorのみBANボタンを表示する(サーバー側でも権限を再チェックする)。
    private var canBan: Bool {
        ban.myRole == "owner" || ban.myRole == "moderator"
    }

    private func participantRow(_ info: PTTParticipantInfo) -> some View {
        HStack(spacing: 8) {
            Text(info.name)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(info.isMuted ? .pttMuted : .pttLive)
                .lineLimit(1)

            Spacer()

            if canBan {
                Button("BAN") {
                    banTarget = info
                }
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundColor(.pttDanger)
            }
        }
    }

    // MARK: - Chat (Phase5)

    /// テキストチャット。書き込みはtoken-server経由、配信・履歴はFirestoreの
    /// リアルタイムリスナー(PTTChatStore)に任せる。BANされた瞬間、
    /// firestore.rules側で読み取り自体もできなくなる。
    private var chatSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("チャット")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.pttMuted)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(chat.messages) { message in
                        Text("\(message.displayName): \(message.text)")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(
                                message.uid == auth.currentUser?.uid
                                    ? .pttLive
                                    : .pttText
                            )
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxHeight: 180)
            .background(.pttPanel.opacity(0.4))

            if let errorMessage = chat.errorMessage {
                Text(errorMessage)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttDanger)
            }

            HStack(spacing: 8) {
                TextField("メッセージを入力", text: $chatInputText)
                    .font(.system(size: 14, design: .monospaced))
                    .padding(8)
                    .background(.pttPanel.opacity(0.6))
                    .onSubmit { sendChatMessage() }

                Button("送信") { sendChatMessage() }
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundColor(.pttAccent)
                    .disabled(chatInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(14)
    }

    private func sendChatMessage() {
        let text = chatInputText
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let roomId = activeRoomId else { return }
        chatInputText = ""
        Task {
            do {
                let idToken = try await auth.fetchIDToken()
                try await chat.sendMessage(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, text: text)
            } catch {
                // chat.errorMessage に理由がセットされているのでUIには既に反映済み。
                // 失敗時は入力内容を戻し、打ち直させずに再送しやすくする。
                chatInputText = text
            }
        }
    }

    // MARK: - Log

    private var logSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(connection.logLines.suffix(50), id: \.self) { line in
                Text(line)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.pttMuted)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview {
    ContentView()
}
