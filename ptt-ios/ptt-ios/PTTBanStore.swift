//
//  PTTBanStore.swift
//  PTTClient
//
//  [BAN対応]
//  Web版(ptt-client/public/index.html)と同じ設計:
//    - 自分の rooms/{roomId}/members/{uid} ドキュメントを読み、role(owner/moderator/member)を
//      取得する。BANボタンの表示可否に使う。
//    - 同じドキュメントをリアルタイム監視(addSnapshotListener)し、statusが'banned'に
//      なった瞬間を検知する。BAN自体の強制力はLiveKit側の即時キック
//      (token-server routes/rooms.js の RoomServiceClient.removeParticipant)が担うが、
//      UI側でも「排除されました」と即座に表示するための補助。
//    - BAN実行(POST /rooms/:roomId/members/:targetUid/ban)はowner/moderatorのみ
//      サーバー側で許可される。クライアント側の role 表示はあくまでUI制御であり、
//      実際の権限チェックはサーバーが行う。
//
//  firestore.rules により、クライアントは自分自身の members/{uid} ドキュメントしか
//  読み取れない(他人のロールやメンバー一覧は取得できない)。そのためBAN対象の一覧は
//  Firestoreではなく PTTConnectionManager.participants (LiveKitの実際の接続情報) を使う。
//
//  事前準備: Xcodeで firebase-ios-sdk パッケージの依存プロダクトに
//  FirebaseFirestore を追加しておく必要がある(PTTChatStoreと共通)。
//

import Foundation
import Combine
import FirebaseFirestore

@MainActor
final class PTTBanStore: ObservableObject {

    /// 現在入室中のルームでの自分のロール。"owner" | "moderator" | "member" | nil(未取得/不明)
    @Published private(set) var myRole: String?
    /// 自分がこのルームからBANされたことを検知した場合にtrueになる。
    @Published private(set) var isBanned = false
    @Published var errorMessage: String?

    private var listener: ListenerRegistration?
    private let db = Firestore.firestore()

    private struct ServerErrorResponse: Decodable { let error: String? }

    private enum BanAPIError: LocalizedError {
        case serverError(statusCode: Int, message: String?)

        var errorDescription: String? {
            switch self {
            case let .serverError(statusCode, message):
                return message ?? "BAN処理に失敗しました (HTTP \(statusCode))"
            }
        }
    }

    /// ルーム入室時に呼ぶ。自分のロールを取得し、BAN状態のリアルタイム監視を開始する。
    func start(roomId: String, uid: String) {
        stop()
        guard !uid.isEmpty else { return }

        let ref = db.collection("rooms").document(roomId).collection("members").document(uid)

        Task {
            do {
                let snapshot = try await ref.getDocument()
                myRole = snapshot.exists ? (snapshot.data()?["role"] as? String ?? "member") : nil
            } catch {
                errorMessage = "ロール取得エラー: \(error.localizedDescription)"
                myRole = nil
            }
        }

        listener = ref.addSnapshotListener { [weak self] snapshot, error in
            guard let self else { return }
            if let error {
                self.errorMessage = "BAN監視エラー: \(error.localizedDescription)"
                return
            }
            guard let snapshot, snapshot.exists else { return }
            if (snapshot.data()?["status"] as? String) == "banned" {
                self.isBanned = true
            }
        }
    }

    /// ルーム退出時に呼ぶ。
    func stop() {
        listener?.remove()
        listener = nil
        myRole = nil
        isBanned = false
    }

    /// owner/moderatorのみ実行可能(サーバー側で強制)。対象ユーザーをこのルームからBANする。
    /// 成功後は対象がLiveKit側から即時キックされ、participantDidDisconnectが発火して
    /// 参加者リストからも自動的に消える。
    func banParticipant(tokenServerURL: String, idToken: String, roomId: String, targetUid: String) async throws {
        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        let encodedTargetUid = targetUid.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? targetUid
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/members/\(encodedTargetUid)/ban") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 200 else {
            let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            let error = BanAPIError.serverError(statusCode: http.statusCode, message: message)
            errorMessage = error.localizedDescription
            throw error
        }
    }
}
