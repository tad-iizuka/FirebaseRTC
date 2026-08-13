//
//  PTTOrgContextStore.swift
//  ptt-ios
//
//  [パンくず表示・組織階層]
//  Web版(ptt-client/src/stores/orgContext.ts)の移植。
//  GET /:roomId/org-context を参照し、Room詳細画面にパンくずを表示する。
//
//  [設計方針(Web版を踏襲)] PTTBadgeStoreとは異なりポーリングしない。
//  Roomの組織階層への割り当て(orgId/nodeId)はadmin-dashboard側での管理者操作
//  でのみ変わり、変化頻度・即時反映の要求のいずれも低いため、入室時に1回
//  取得すれば十分と判断した。
//

import Foundation
import Combine

struct PTTOrgBreadcrumbNode: Decodable, Equatable, Identifiable {
    let nodeId: String
    let name: String
    let depth: Int

    var id: String { nodeId }
}

private struct PTTOrgContextResponse: Decodable {
    let orgId: String?
    let orgName: String?
    let breadcrumb: [PTTOrgBreadcrumbNode]
}

@MainActor
final class PTTOrgContextStore: ObservableObject {

    @Published private(set) var orgName: String?
    @Published private(set) var breadcrumb: [PTTOrgBreadcrumbNode] = []
    @Published var errorMessage: String?

    private var fetchTask: Task<Void, Never>?

    /// ルーム入室時に1回だけ呼ぶ。
    func fetchOnce(tokenServerURL: String, roomId: String, idTokenProvider: @escaping () async throws -> String) {
        fetchTask?.cancel()
        fetchTask = Task { [weak self] in
            guard let self else { return }
            do {
                let idToken = try await idTokenProvider()
                let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
                guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/org-context") else {
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
                let decoded = try JSONDecoder().decode(PTTOrgContextResponse.self, from: data)
                guard !Task.isCancelled else { return }
                self.orgName = decoded.orgName
                self.breadcrumb = decoded.breadcrumb
                self.errorMessage = nil
            } catch {
                // 無所属Roomの方が多数派になりうる想定のため、取得失敗時も
                // UI全体を止めず「表示しない」で済ませる(PTTBadgeStoreと同じ方針)。
                if !Task.isCancelled {
                    self.errorMessage = error.localizedDescription
                }
            }
        }
    }

    /// ルーム退出時に呼ぶ。
    func reset() {
        fetchTask?.cancel()
        fetchTask = nil
        orgName = nil
        breadcrumb = []
        errorMessage = nil
    }
}
