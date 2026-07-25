//
//  PTTReportStore.swift
//  ptt-ios
//
//  [通報UI]
//  Web版(ptt-client/src/views/RoomView.vue の reportParticipant)の移植。
//  token-server/routes/reports.js の POST /reports を呼ぶだけの薄いストア。
//
//  [重要] このAPIは通報データの受付のみを行う。実際の対応(内容確認・BAN実行)は、
//  モデレーターがFirestoreの reports コレクションを見て手動で行う運用のため、
//  クライアント側はここでの受付(201)を確認するところまでが責務であり、
//  通報後に何らかの自動処理(自動BAN等)を行うことはない。
//

import Foundation
import Combine

@MainActor
final class PTTReportStore: ObservableObject {

    @Published private(set) var isSubmitting = false
    @Published var errorMessage: String?

    private struct ServerErrorResponse: Decodable { let error: String? }

    private enum ReportAPIError: LocalizedError {
        case serverError(statusCode: Int, message: String?)

        var errorDescription: String? {
            switch self {
            case let .serverError(statusCode, message):
                return message ?? String(format: NSLocalizedString("通報の送信に失敗しました (HTTP %d)", comment: "Report submission failure"), statusCode)
            }
        }
    }

    /// - Parameter reason: 空文字はサーバー側でも400エラーになる。呼び出し側で
    ///   trimmingCharacters等により空でないことを確認してから呼ぶこと
    ///   (Web版のreportParticipantが `window.prompt` の戻り値をtrimして
    ///   空なら送信自体をskipしているのと同じ扱い)。
    func submitReport(tokenServerURL: String, idToken: String, roomId: String, reportedUid: String, reason: String) async throws {
        isSubmitting = true
        defer { isSubmitting = false }
        errorMessage = nil

        guard let url = URL(string: "\(tokenServerURL)/reports") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "roomId": roomId,
            "reportedUid": reportedUid,
            "reason": reason,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 201 else {
            let message = try? JSONDecoder().decode(ServerErrorResponse.self, from: data).error
            let error = ReportAPIError.serverError(statusCode: http.statusCode, message: message)
            errorMessage = error.localizedDescription
            throw error
        }
    }
}
