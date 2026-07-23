//
//  PTTRoomManager.swift
//  PTTClient
//
//  [招待制ルーム対応]
//  token-server は「ルームIDを知っていれば誰でも入れる」設計ではなく、
//  invite_only(招待制)になっている。/token を取得する前に、必ず
//    - POST /rooms            (ルーム作成。呼び出しユーザーがownerになる)
//    - POST /rooms/:roomId/join  (招待コードを検証してmembersに追加)
//  のいずれかでルームのメンバーになっている必要がある(token-server/routes/rooms.js)。
//  Web版(ptt-client/public/index.html)のcreateRoomBtn/joinRoomBtnに相当する処理を
//  iOS側にも用意する。
//

import Foundation
import Combine

@MainActor
final class PTTRoomManager: ObservableObject {

    @Published private(set) var isWorking = false
    @Published private(set) var lastErrorMessage: String?

    func clearError() {
        lastErrorMessage = nil
    }

    private struct CreateRoomResponse: Decodable {
        let roomId: String
        let inviteCode: String
    }

    private struct ServerErrorResponse: Decodable {
        let error: String?
    }

    private enum RoomAPIError: LocalizedError {
        case serverError(statusCode: Int, message: String?)

        var errorDescription: String? {
            switch self {
            case let .serverError(statusCode, message):
                return message ?? String(format: NSLocalizedString("リクエストに失敗しました (HTTP %d)", comment: "Request failure"), statusCode)
            }
        }
    }

    /// 新しいルームを作成する。戻り値はownerとして払い出される招待コードとルームID。
    func createRoom(tokenServerURL: String, idToken: String, maxMembers: Int? = nil) async throws -> (roomId: String, inviteCode: String) {
        isWorking = true
        defer { isWorking = false }
        lastErrorMessage = nil

        guard let url = URL(string: "\(tokenServerURL)/rooms") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [:]
        if let maxMembers { body["maxMembers"] = maxMembers }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 201 else {
            let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            let error = RoomAPIError.serverError(statusCode: http.statusCode, message: message)
            lastErrorMessage = error.localizedDescription
            throw error
        }
        let decoded = try JSONDecoder().decode(CreateRoomResponse.self, from: data)
        return (decoded.roomId, decoded.inviteCode)
    }

    /// 招待コードを検証してルームのmembersに参加する。
    func joinRoom(tokenServerURL: String, idToken: String, roomId: String, inviteCode: String) async throws {
        isWorking = true
        defer { isWorking = false }
        lastErrorMessage = nil

        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/join") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["inviteCode": inviteCode])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 200 else {
            let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            let error = RoomAPIError.serverError(statusCode: http.statusCode, message: message)
            lastErrorMessage = error.localizedDescription
            throw error
        }
    }
}
