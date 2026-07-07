//
//  ContentView.swift
//  PTTClient
//
//  [LiveKit移行 + Firebase Auth対応 + 招待制ルーム対応]
//  Web版(ptt-client/public/index.html)と同等のUI:
//  Googleサインイン → ルーム作成/招待コード参加 → PTTボタン → 送話中リスト → ログ
//  クライアントIDの手入力は廃止(token-serverは常にFirebase ID Token由来のuidを
//  identityとして使うため、クライアントが自己申告する値は元々使われていなかった)。
//  ルームIDの直接入力による接続も廃止し、token-serverのinvite_only設計
//  (POST /rooms でルーム作成、POST /rooms/:roomId/join で招待コード検証)に合わせた。
//

import SwiftUI
import FirebaseAuth

struct ContentView: View {

    @StateObject private var auth = PTTAuthManager()
    @StateObject private var roomManager = PTTRoomManager()
    @StateObject private var savedRooms = PTTSavedRoomsStore()
    @StateObject private var connection = PTTConnectionManager()

    @State private var tokenServerURL: String = "https://ptt-token-server-rnn4fqay3a-an.a.run.app"
    @State private var livekitURL: String = "wss://ubunifu-talk-wy19xst3.livekit.cloud"
    @State private var joinRoomId: String = ""
    @State private var joinInviteCode: String = ""

    /// 実際に作成/参加してLiveKit接続に進んだルームID。nilの間はルーム選択画面を表示する。
    @State private var activeRoomId: String?
    /// 自分がルーム作成者(owner)の場合のみセットされる、参加者への共有用招待コード。
    @State private var currentInviteCode: String?

    var body: some View {
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
                    logSection
                } else {
                    roomSelectionSection
                }
            }
        }
        .background(Color(red: 0.05, green: 0.07, blue: 0.06))
        .foregroundColor(Color(red: 0.85, green: 0.89, blue: 0.86))
        .onChange(of: auth.currentUser?.uid, initial: true) { _, newUid in
            savedRooms.load(forUid: newUid)
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
                    .stroke(Color.orange, lineWidth: 1)
            )
            .foregroundColor(.orange)
            .disabled(auth.isSigningIn)

            if let message = auth.lastErrorMessage {
                Text(message)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(Color(red: 1.0, green: 0.36, blue: 0.36))
            }
        }
        .padding(14)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("PTT CLIENT")
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundColor(.gray)
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
                .foregroundColor(.gray)
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
                .foregroundColor(.gray)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 10)
    }

    private var statusColor: Color {
        switch connection.status {
        case .connected: return Color(red: 0.24, green: 0.86, blue: 0.52)
        case .reconnecting: return Color(red: 0.95, green: 0.72, blue: 0.2) // 黄色系: 再接続試行中であることを目立たせる
        case .error: return Color(red: 1.0, green: 0.36, blue: 0.36)
        default: return .gray
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
            field(label: "トークンサーバーURL", text: $tokenServerURL)
            field(label: "LiveKit URL (wss://)", text: $livekitURL)

            Button(action: handleCreateRoom) {
                Text(roomManager.isWorking ? "作成中..." : "新しいルームを作成する")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
            }
            .buttonStyle(.plain)
            .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color.orange, lineWidth: 1))
            .foregroundColor(.orange)
            .disabled(roomManager.isWorking)

            Text("— または —")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.gray)
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
            .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color.gray.opacity(0.5), lineWidth: 1))
            .foregroundColor(.gray)
            .disabled(roomManager.isWorking)

            if let message = roomManager.lastErrorMessage {
                Text(message)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(Color(red: 1.0, green: 0.36, blue: 0.36))
            }

            if !savedRooms.rooms.isEmpty {
                Text("— 最近使ったルーム —")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.gray)
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
                Text("\(saved.label) (\(saved.roomId))")
                    .font(.system(size: 12, design: .monospaced))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
            }
            .buttonStyle(.plain)
            .background(Color.black.opacity(0.3))

            Button("削除") {
                savedRooms.remove(roomId: saved.roomId)
            }
            .font(.system(size: 11, design: .monospaced))
            .foregroundColor(.gray)
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
                    .foregroundColor(.orange)
                Text("ルームID: \(roomId)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.gray)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4]))
                    .foregroundColor(.orange)
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
        .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color.gray.opacity(0.4), lineWidth: 1))
        .foregroundColor(.gray)
        .padding(14)
    }

    private func field(label: String, text: Binding<String>, placeholder: String = "") -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.gray)
            TextField(placeholder, text: text)
                .font(.system(size: 14, design: .monospaced))
                .padding(8)
                .background(Color.black.opacity(0.3))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
    }

    private var isConnected: Bool {
        if case .connected = connection.status { return true }
        return false
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
                currentInviteCode = nil
                savedRooms.upsert(roomId: roomId, label: "招待コードで参加したルーム", inviteCode: nil)
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
        activeRoomId = roomId
        connection.connect(
            tokenServerURL: tokenServerURL,
            livekitURL: livekitURL,
            room: roomId,
            idTokenProvider: { try await auth.fetchIDToken() }
        )
    }

    private func leaveRoom() {
        if connection.status != .disconnected { connection.disconnect() }
        activeRoomId = nil
        currentInviteCode = nil
        joinRoomId = ""
        joinInviteCode = ""
    }

    // MARK: - Talk area (PTT button)

    private var talkArea: some View {
        VStack(spacing: 14) {
            Circle()
                .strokeBorder(connection.isSending ? Color.orange : Color.gray.opacity(0.4), lineWidth: 2)
                .background(Circle().fill(Color.black.opacity(0.3)))
                .frame(width: 150, height: 150)
                .overlay(
                    Text(connection.isSending ? "送話中" : "押して送話")
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundColor(connection.isSending ? .orange : .gray)
                )
                .scaleEffect(connection.isSending ? 0.97 : 1.0)
                .opacity(isConnected ? 1.0 : 0.3)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in connection.startTalking() }
                        .onEnded { _ in connection.stopTalking() }
                )
                .allowsHitTesting(isConnected)

            Text("ボタンを押している間だけ音声が送信されます")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.gray)
        }
        .padding(.vertical, 24)
    }

    // MARK: - Talkers

    private var talkerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("送話中")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.gray)

            if connection.talkers.isEmpty {
                chip(text: "— なし —", live: false)
            } else {
                FlowLayoutHStackFallback(items: Array(connection.talkers))
            }
        }
        .padding(14)
    }

    private func chip(text: String, live: Bool) -> some View {
        Text(text)
            .font(.system(size: 11, design: .monospaced))
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .overlay(
                Capsule().stroke(live ? Color(red: 0.24, green: 0.86, blue: 0.52) : Color.gray.opacity(0.4))
            )
            .foregroundColor(live ? Color(red: 0.24, green: 0.86, blue: 0.52) : .gray)
    }

    // MARK: - Log

    private var logSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(connection.logLines.suffix(50), id: \.self) { line in
                Text(line)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.gray)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// シンプルな折り返しチップ表示（iOS17のWrappingHStack代替の簡易実装）
private struct FlowLayoutHStackFallback: View {
    let items: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items, id: \.self) { id in
                    Text(id)
                        .font(.system(size: 11, design: .monospaced))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .overlay(
                            Capsule().stroke(Color(red: 0.24, green: 0.86, blue: 0.52))
                        )
                        .foregroundColor(Color(red: 0.24, green: 0.86, blue: 0.52))
                }
            }
        }
    }
}

#Preview {
    ContentView()
}
