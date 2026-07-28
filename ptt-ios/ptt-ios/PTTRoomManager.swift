//
//  PTTRoomManager.swift
//  PTTClient
//
//  [招待制ルーム対応]
//  token-server は「ルームIDを知っていれば誰でも入れる」設計ではなく、
//  invite_only(招待制)になっている。/token を取得する前に、必ず
//    - POST /rooms/:roomId/join  (招待コードを検証してmembersに追加)
//  でルームのメンバーになっている必要がある(token-server/routes/rooms.js)。
//  Web版(ptt-client/src/stores/room.ts)と同じ役割。
//
//  [ルーム作成のadmin-dashboard移管]
//  以前はここに createRoom() (POST /rooms) があったが、ルーム作成は
//  admin-dashboard専用の POST /admin/rooms (rooms:create権限)へ移管した。
//  ptt-ios側からはルームを作成できない(brushup-plan.md参照)。
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

    private struct JoinRoomResponse: Decodable {
        let roomId: String
        let joined: Bool
        // [ルーム名] admin-dashboardで設定されたルーム名。未設定の場合はnull。
        let name: String?
    }

    /// GET /rooms/:roomId/recording/status のうち、ここでは name のみを使う。
    /// Web版 stores/room.ts の fetchAutoRecording に相当(iOS側はautoRecording
    /// トグル自体がスコープ外のため、ルーム名の再取得だけを行う軽量版)。
    private struct RoomStatusResponse: Decodable {
        let name: String?
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

    /// 招待コードを検証してルームのmembersに参加する。戻り値はadmin-dashboardで
    /// 設定されたルーム名(未設定の場合はnil)。
    @discardableResult
    func joinRoom(tokenServerURL: String, idToken: String, roomId: String, inviteCode: String) async throws -> String? {
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
        let decoded = try? JSONDecoder().decode(JoinRoomResponse.self, from: data)
        return decoded?.name
    }

    /// 現在のルーム名をサーバーから取得し直す。/join を経由しない再入室時や、
    /// admin-dashboard側でルーム名が変更された可能性がある場合の最新化に使う
    /// (Web版 room.ts の fetchAutoRecording と同じくGET /recording/statusに相乗り)。
    func fetchRoomName(tokenServerURL: String, idToken: String, roomId: String) async -> String? {
        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/recording/status") else {
            return nil
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(RoomStatusResponse.self, from: data).name
        } catch {
            // ルーム名の再取得失敗はPTT自体の利用を妨げないため、エラーはログ用途に留める
            return nil
        }
    }
}
