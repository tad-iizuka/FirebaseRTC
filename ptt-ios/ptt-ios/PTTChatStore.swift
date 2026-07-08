//
//  PTTChatStore.swift
//  PTTClient
//
//  [Phase5: テキストチャット]
//  Web版(ptt-client/public/index.html)と同じ設計: 書き込みはtoken-server経由のみ、
//  配信・履歴表示はFirestoreのリアルタイムリスナー(addSnapshotListener)に任せる。
//  LiveKitのData Channelは使わない(サーバーを経由しないためモデレーション・履歴配信・
//  BAN時の読み取り遮断ができないため)。BANされるとfirestore.rules側で読み取り権限
//  自体を失う(PTTRoomManagerのBAN即時反映と同じ二重の強制力を持たせる設計)。
//
//  事前準備: Xcodeで firebase-ios-sdk パッケージの依存プロダクトに
//  FirebaseFirestore を追加しておく必要がある
//  (ターゲット → Frameworks, Libraries, and Embedded Content → + → FirebaseFirestore)。
//

import Foundation
import Combine
import FirebaseFirestore

struct ChatMessage: Identifiable, Codable, Equatable {
    @DocumentID var id: String?
    let uid: String
    let displayName: String
    let text: String
    let createdAt: Date
}

@MainActor
final class PTTChatStore: ObservableObject {

    @Published private(set) var messages: [ChatMessage] = []
    @Published var errorMessage: String?

    private var listener: ListenerRegistration?
    private let db = Firestore.firestore()

    private struct ServerErrorResponse: Decodable { let error: String? }

    /// ルーム入室時に呼ぶ。直近200件の履歴をリアルタイムに購読する。
    func start(roomId: String) {
        stop()
        let query = db.collection("rooms").document(roomId).collection("messages")
            .order(by: "createdAt", descending: true)
            .limit(to: 200)

        listener = query.addSnapshotListener { [weak self] snapshot, error in
            guard let self else { return }
            if let error {
                self.errorMessage = "チャット履歴の取得に失敗しました: \(error.localizedDescription)"
                return
            }
            guard let snapshot else { return }
            let docs = snapshot.documents.compactMap { try? $0.data(as: ChatMessage.self) }
            self.messages = docs.reversed() // 古い→新しい順に並べ直す
        }
    }

    /// ルーム退出時に呼ぶ。
    func stop() {
        listener?.remove()
        listener = nil
        messages = []
    }

    /// テキストを送信する。永続化・配信はサーバー(token-server)経由で行われるため、
    /// このメソッド自身はFirestoreへ書き込まない。
    func sendMessage(tokenServerURL: String, idToken: String, roomId: String, text: String) async throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/messages") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["text": trimmed])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 201 else {
            let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            let errorText = message ?? "メッセージの送信に失敗しました (HTTP \(http.statusCode))"
            self.errorMessage = errorText
            throw URLError(.badServerResponse)
        }
    }
}
