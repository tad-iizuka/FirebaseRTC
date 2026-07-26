//
//  PTTBadgeStore.swift
//  ptt-ios
//
//  [Phase13 バッジ表示UI]
//  Web版(ptt-client/src/stores/badges.ts・src/components/ParticipantList.vue)の移植。
//  次アクション item3「iOS/Androidにバッジ表示UIを実装する」に対応。
//
//  [設計方針(Web版を踏襲)]
//  送話ロック・録音状態のようなLiveKit Room Metadata経由のリアルタイム反映は
//  行わない(バッジの変化頻度は低く、Owner操作の即時性が強く求められる性質の
//  ものでもないため)。PTTBanStoreのmyRoleのようにFirestoreへ直接
//  addSnapshotListenerすることもしない(badges/badgeGrantsはfirestore.rulesで
//  クライアントへの直接読み取りを禁止しているため、そもそも購読できない)。
//
//  GET /:roomId/badges を一定間隔(Web版と同じ20秒)でポーリングする、
//  シンプルな実装にとどめる(Phase13はPoCスコープ)。
//
//  [副次的な効果] このAPIはrole不問でRoomメンバーなら誰でも呼べるため、
//  Guestの役割バッジ(source: "guest-role")も他参加者から見える形で返る。
//  これにより「5.4 他参加者のGuest判定手段の欠如」がiOS版でも解消される
//  (二十訂でWeb版のみ解消済みだった箇所)。
//

import Foundation
import Combine

/// token-server(lib/badges.js)が返すバッジ1件分。Web版 AssignedBadge に相当。
struct PTTAssignedBadge: Decodable, Equatable {
    let badgeId: String
    let name: String
    let icon: String
    let category: String // "role" | "skill" | "unit" | "rank" | "other"
    let priority: Int
    let source: String // "grant" | "guest-role"
}

/// GET /:roomId/badges の1メンバー分。Web版 RoomMemberBadges に相当。
private struct PTTRoomMemberBadges: Decodable {
    let badges: [PTTAssignedBadge]
    let topBadge: PTTAssignedBadge?
}

private struct PTTRoomBadgesResponse: Decodable {
    let roomId: String
    let members: [String: PTTRoomMemberBadges]
}

@MainActor
final class PTTBadgeStore: ObservableObject {

    /// uid -> 最優先1件のバッジ。未取得のuidはこの辞書に存在しない(nilと区別しない。
    /// Web版のtopBadgeFor(uid)と同じくnilなら「バッジなし/未取得」として扱ってよい)。
    @Published private(set) var topBadges: [String: PTTAssignedBadge] = [:]
    @Published var errorMessage: String?

    /// Web版 POLL_INTERVAL_MS と同じ間隔。
    private static let pollIntervalSeconds: TimeInterval = 20

    private var timer: Timer?
    private var fetchTask: Task<Void, Never>?

    private func fetchOnce(tokenServerURL: String, roomId: String, idTokenProvider: @escaping () async throws -> String) {
        fetchTask?.cancel()
        fetchTask = Task { [weak self] in
            guard let self else { return }
            do {
                let idToken = try await idTokenProvider()
                let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
                guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/badges") else {
                    throw URLError(.badURL)
                }
                var request = URLRequest(url: url)
                request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    throw URLError(.badServerResponse)
                }
                let decoded = try JSONDecoder().decode(PTTRoomBadgesResponse.self, from: data)
                guard !Task.isCancelled else { return }
                self.topBadges = decoded.members.compactMapValues { $0.topBadge }
                self.errorMessage = nil
            } catch {
                // ポーリングの一時的な失敗でUI全体を止めたくないため、エラーは保持する
                // のみでスローしない(Web版と同じく、表示専用の補助情報のため)。
                if !Task.isCancelled {
                    self.errorMessage = error.localizedDescription
                }
            }
        }
    }

    /// ルーム入室時に呼ぶ。
    func start(tokenServerURL: String, roomId: String, idTokenProvider: @escaping () async throws -> String) {
        stop()
        fetchOnce(tokenServerURL: tokenServerURL, roomId: roomId, idTokenProvider: idTokenProvider)
        timer = Timer.scheduledTimer(withTimeInterval: Self.pollIntervalSeconds, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                self.fetchOnce(tokenServerURL: tokenServerURL, roomId: roomId, idTokenProvider: idTokenProvider)
            }
        }
    }

    /// ルーム退出時に呼ぶ。
    func stop() {
        timer?.invalidate()
        timer = nil
        fetchTask?.cancel()
        fetchTask = nil
        topBadges = [:]
        errorMessage = nil
    }

    func topBadge(for uid: String) -> PTTAssignedBadge? {
        topBadges[uid]
    }
}
