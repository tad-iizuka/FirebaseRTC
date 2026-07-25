//
//  PTTRecordingStore.swift
//  ptt-ios
//
//  [録音開始/停止UI]
//  Web版(ptt-client/src/stores/recording.ts)の移植。
//
//  実際に「録音中である」状態(active/startedAt)は Room Metadata 経由で
//  PTTConnectionManager が保持している(全参加者へのリアルタイム開示のため)。
//  このstoreは owner/moderator が叩く /recording/start・/recording/stop の
//  リクエスト自体と、そのローディング状態・エラー表示だけを担当する。
//
//  [重要] /recording/start のレスポンスが返った時点ではまだ録音は開始されておらず、
//  /recording/stop も「停止を依頼した」だけ(token-server/routes/recording.js参照)。
//  実際に録音中かどうかの確定状態は必ず PTTConnectionManager.isRecording を見ること。
//  このstoreの starting/stopping はあくまで「リクエストを送信中かどうか」の
//  ローディング表示用。
//

import Foundation
import Combine

@MainActor
final class PTTRecordingStore: ObservableObject {

    @Published private(set) var starting = false
    @Published private(set) var stopping = false
    @Published var errorMessage: String?

    private struct ServerErrorResponse: Decodable { let error: String? }

    private enum RecordingAPIError: LocalizedError {
        case serverError(statusCode: Int, message: String?)

        var errorDescription: String? {
            switch self {
            case let .serverError(statusCode, message):
                return message ?? String(format: NSLocalizedString("録音の操作に失敗しました (HTTP %d)", comment: "Recording operation failure"), statusCode)
            }
        }
    }

    /// owner/moderatorのみ実行可能(サーバー側で強制)。既に録音中の場合は409が返る。
    func startRecording(tokenServerURL: String, idToken: String, roomId: String) async throws {
        starting = true
        defer { starting = false }
        errorMessage = nil

        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/recording/start") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 200 else {
            let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            let error = RecordingAPIError.serverError(statusCode: http.statusCode, message: message)
            errorMessage = error.localizedDescription
            throw error
        }
        // 開始の確定通知(recording.active: true)はRoom Metadata経由で
        // PTTConnectionManagerへ非同期に届く。ここでは楽観的に状態を変えない。
    }

    /// owner/moderatorのみ実行可能(サーバー側で強制)。録音中でなくても冪等に成功する。
    func stopRecording(tokenServerURL: String, idToken: String, roomId: String) async throws {
        stopping = true
        defer { stopping = false }
        errorMessage = nil

        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/recording/stop") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 200 else {
            let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            let error = RecordingAPIError.serverError(statusCode: http.statusCode, message: message)
            errorMessage = error.localizedDescription
            throw error
        }
        // これも「停止を依頼した」だけ。active:falseへの確定はegress_endedの
        // Webhook経由でRoom Metadataが更新されてからPTTConnectionManagerに反映される。
    }
}
