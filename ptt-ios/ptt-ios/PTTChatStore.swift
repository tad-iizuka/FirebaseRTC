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
//  [Phase16: 添付ファイル(画像/動画/PDF)]
//  Web版(ptt-client/src/stores/chat.ts)の移植。アップロードはtoken-serverを
//  経由せず、署名付きURLへ直接PUTする(sendAttachment参照)。閲覧用の署名付きURLは
//  有効期限が短い(5分)ため、messageIdをキーにメモリ内キャッシュして
//  期限が近づくまで再発行しない(attachmentURL/thumbnailURL参照)。
//

import Foundation
import Combine
import FirebaseFirestore
import UIKit

/// [Phase16] `rooms/{roomId}/messages/{messageId}.attachment` のFirestore形状。
/// token-server/lib/attachments.js が確定した値をそのまま書き込む。
enum AttachmentKind: String, Codable {
    case image
    case video
    case pdf
}

struct ChatAttachment: Codable, Equatable {
    let storagePath: String
    let thumbnailPath: String?
    let contentType: String
    let kind: AttachmentKind
    let fileName: String
    let size: Int
}

struct ChatMessage: Identifiable, Codable, Equatable {
    @DocumentID var id: String?
    let uid: String
    let displayName: String
    let text: String
    let createdAt: Date
    // [Phase16] 添付が無いメッセージにはフィールド自体が存在しない
    var attachment: ChatAttachment?
    // [チャットUI刷新・五十六訂のiOS移植] 送信時点のroleとphotoUrl。
    // Web版(ptt-client/src/types/api.ts)と同じくメッセージドキュメント自身に
    // スナップショットされている値をそのまま使う(moderator任命等で後から
    // roleが変わっても過去メッセージのroleは遡及更新されない)。
    // token-server/routes/messages.js側の追加時点より前に書き込まれた
    // 既存メッセージにはフィールド自体が存在しないため、双方オプショナルにする。
    // photoUrlはプロフィール写真機能が未実装の現状は常にnull。
    var role: String?
    var photoUrl: String?
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
                self.errorMessage = String(format: NSLocalizedString("チャット履歴の取得に失敗しました: %@", comment: "Chat fetch error"), error.localizedDescription)
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
        attachmentURLCache.removeAll()
        thumbnailURLCache.removeAll()
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
        if let appCheckToken = await PTTAppCheck.token() {
            request.setValue(appCheckToken, forHTTPHeaderField: "X-Firebase-AppCheck")
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["text": trimmed])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 201 else {
            let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            let errorText = message ?? String(format: NSLocalizedString("メッセージの送信に失敗しました (HTTP %d)", comment: "Message send failure"), http.statusCode)
            self.errorMessage = errorText
            throw URLError(.badServerResponse)
        }
    }

    // MARK: - Phase16: 添付ファイル送信

    private struct UploadURLResponse: Decodable {
        let uploadUrl: String
        let storagePath: String
        let expiresInMs: Int
    }

    private struct DownloadURLResponse: Decodable {
        let url: String
        let expiresInMs: Int
    }

    /// [Phase16] 画像/動画/PDFを添付してメッセージを送信する。
    ///   1. 画像なら圧縮(compressImageIfNeeded、動画/PDFはそのまま)
    ///   2. アップロードURLを発行してもらう
    ///   3. そのURLへ直接PUT(token-serverを経由しない)
    ///   4. POST /messages で確定する(ここでサーバー側がGCS実体を検証する)
    func sendAttachment(
        tokenServerURL: String,
        idToken: String,
        roomId: String,
        fileData: Data,
        fileName: String,
        contentType: String,
        text: String = ""
    ) async throws {
        errorMessage = nil
        do {
            let (uploadData, uploadName, uploadType) = compressImageIfNeeded(
                data: fileData, fileName: fileName, contentType: contentType
            )

            let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
            guard let uploadUrlEndpoint = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/attachments/upload-url") else {
                throw URLError(.badURL)
            }
            var uploadUrlRequest = URLRequest(url: uploadUrlEndpoint)
            uploadUrlRequest.httpMethod = "POST"
            uploadUrlRequest.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
            if let appCheckToken = await PTTAppCheck.token() {
                uploadUrlRequest.setValue(appCheckToken, forHTTPHeaderField: "X-Firebase-AppCheck")
            }
            uploadUrlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            uploadUrlRequest.httpBody = try JSONSerialization.data(withJSONObject: [
                "contentType": uploadType,
                "fileName": uploadName,
                "size": uploadData.count,
            ])

            let (uploadUrlData, uploadUrlResp) = try await URLSession.shared.data(for: uploadUrlRequest)
            guard let uploadUrlHttp = uploadUrlResp as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            guard uploadUrlHttp.statusCode == 200 else {
                let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: uploadUrlData).error
                throw self.chatAttachmentError(message: message, statusCode: uploadUrlHttp.statusCode, fallback: "添付ファイルのアップロードURL発行に失敗しました")
            }
            let uploadInfo = try JSONDecoder().decode(UploadURLResponse.self, from: uploadUrlData)

            guard let putURL = URL(string: uploadInfo.uploadUrl) else { throw URLError(.badURL) }
            var putRequest = URLRequest(url: putURL)
            putRequest.httpMethod = "PUT"
            putRequest.setValue(uploadType, forHTTPHeaderField: "Content-Type")
            let (_, putResp) = try await URLSession.shared.upload(for: putRequest, from: uploadData)
            guard let putHttp = putResp as? HTTPURLResponse, (200...299).contains(putHttp.statusCode) else {
                throw self.chatAttachmentError(message: nil, statusCode: nil, fallback: NSLocalizedString("添付ファイルのアップロードに失敗しました", comment: "Attachment upload failed"))
            }

            guard let messagesEndpoint = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/messages") else {
                throw URLError(.badURL)
            }
            var confirmRequest = URLRequest(url: messagesEndpoint)
            confirmRequest.httpMethod = "POST"
            confirmRequest.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
            if let appCheckToken = await PTTAppCheck.token() {
                confirmRequest.setValue(appCheckToken, forHTTPHeaderField: "X-Firebase-AppCheck")
            }
            confirmRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            confirmRequest.httpBody = try JSONSerialization.data(withJSONObject: [
                "text": text.trimmingCharacters(in: .whitespacesAndNewlines),
                "attachment": ["storagePath": uploadInfo.storagePath, "fileName": uploadName],
            ])

            let (confirmData, confirmResp) = try await URLSession.shared.data(for: confirmRequest)
            guard let confirmHttp = confirmResp as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            guard confirmHttp.statusCode == 201 else {
                let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: confirmData).error
                throw self.chatAttachmentError(message: message, statusCode: confirmHttp.statusCode, fallback: "メッセージの送信に失敗しました")
            }
        } catch {
            if self.errorMessage == nil {
                self.errorMessage = error.localizedDescription
            }
            throw error
        }
    }

    private func chatAttachmentError(message: String?, statusCode: Int?, fallback: String) -> Error {
        let text: String
        if let message {
            text = message
        } else if let statusCode {
            text = "\(fallback) (HTTP \(statusCode))"
        } else {
            text = fallback
        }
        self.errorMessage = text
        return NSError(domain: "PTTChatStore", code: statusCode ?? -1, userInfo: [NSLocalizedDescriptionKey: text])
    }

    // MARK: - Phase16: 署名付き閲覧URLのメモリ内キャッシュ(messageIdをキーとする)

    private struct CachedURL {
        let url: String
        let expiresAt: Date
    }
    private var attachmentURLCache: [String: CachedURL] = [:]
    private var thumbnailURLCache: [String: CachedURL] = [:]
    private let refreshMarginSeconds: TimeInterval = 10

    /// 添付ファイル本体の短期署名付き閲覧URLを発行する(サーバーの有効期限(5分)より
    /// 前に、期限が近づいたら再発行する)。
    func getAttachmentURL(tokenServerURL: String, idToken: String, roomId: String, messageId: String) async throws -> String {
        try await fetchDownloadURL(
            cache: \.attachmentURLCache,
            tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, messageId: messageId,
            suffix: "attachment-url"
        )
    }

    /// サムネイルの短期署名付き閲覧URLを発行する。
    func getThumbnailURL(tokenServerURL: String, idToken: String, roomId: String, messageId: String) async throws -> String {
        try await fetchDownloadURL(
            cache: \.thumbnailURLCache,
            tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId, messageId: messageId,
            suffix: "thumbnail-url"
        )
    }

    // MARK: - Phase16: 画像圧縮(Web版 lib/imageCompression.ts の移植)

    /// brushup-planの「7.3」で確定した「画像はクライアント側で圧縮してから
    /// アップロードする(サーバー側では動画/PDFと共通の100MB上限のみチェック)」を
    /// 実現する。動画・PDFはこの関数の対象外(そのままアップロードする)。
    /// GIFはアニメーションを保持したいことが多く、JPEG化すると壊れるため対象外とする。
    private func compressImageIfNeeded(data: Data, fileName: String, contentType: String) -> (Data, String, String) {
        let maxBytes = 1024 * 1024 // 1MB
        let maxDimension: CGFloat = 1920
        let minQuality: CGFloat = 0.4

        guard contentType.hasPrefix("image/"), contentType != "image/gif" else {
            return (data, fileName, contentType)
        }
        guard data.count > maxBytes else {
            return (data, fileName, contentType)
        }
        guard let image = UIImage(data: data) else {
            return (data, fileName, contentType)
        }

        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let targetSize = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
        let renderer = UIGraphicsImageRenderer(size: targetSize)
        let resized = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }

        var quality: CGFloat = 0.9
        var jpegData: Data?
        while quality >= minQuality {
            if let candidate = resized.jpegData(compressionQuality: quality) {
                jpegData = candidate
                if candidate.count <= maxBytes { break }
            }
            quality -= 0.15
        }

        guard let finalData = jpegData else {
            return (data, fileName, contentType)
        }
        let baseName = (fileName as NSString).deletingPathExtension
        let newFileName = (baseName.isEmpty ? "image" : baseName) + ".jpg"
        return (finalData, newFileName, "image/jpeg")
    }

    private func fetchDownloadURL(
        cache cacheKeyPath: ReferenceWritableKeyPath<PTTChatStore, [String: CachedURL]>,
        tokenServerURL: String, idToken: String, roomId: String, messageId: String, suffix: String
    ) async throws -> String {
        if let cached = self[keyPath: cacheKeyPath][messageId],
           cached.expiresAt.timeIntervalSinceNow > refreshMarginSeconds {
            return cached.url
        }

        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        let encodedMessageId = messageId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? messageId
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/messages/\(encodedMessageId)/\(suffix)") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        if let appCheckToken = await PTTAppCheck.token() {
            request.setValue(appCheckToken, forHTTPHeaderField: "X-Firebase-AppCheck")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        let decoded = try JSONDecoder().decode(DownloadURLResponse.self, from: data)
        self[keyPath: cacheKeyPath][messageId] = CachedURL(
            url: decoded.url,
            expiresAt: Date().addingTimeInterval(TimeInterval(decoded.expiresInMs) / 1000)
        )
        return decoded.url
    }
}
