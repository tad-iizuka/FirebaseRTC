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

/// [2026-08-04・次アクションitem4] Room内owner向け「付与できるバッジ」の選択肢。
/// Web版(ptt-client/src/types/api.ts の GrantableBadge)と同じフィールド構成。
/// owner以外にはサーバー側からnullが返る(lib/badges.js listRoomOwnerGrantableBadges参照)。
struct PTTGrantableBadge: Decodable, Equatable, Identifiable {
    var id: String { badgeId }
    let badgeId: String
    let name: String
    let icon: String
    let category: String
}

private struct PTTRoomBadgesResponse: Decodable {
    let roomId: String
    let members: [String: PTTRoomMemberBadges]
    let grantableBadges: [PTTGrantableBadge]?
}

private struct PTTBadgeErrorResponse: Decodable { let error: String? }

private enum PTTBadgeAPIError: LocalizedError {
    case serverError(statusCode: Int, message: String?)

    var errorDescription: String? {
        switch self {
        case let .serverError(statusCode, message):
            return message ?? String(format: NSLocalizedString("バッジ操作に失敗しました (HTTP %d)", comment: "Badge grant/revoke failed"), statusCode)
        }
    }
}

@MainActor
final class PTTBadgeStore: ObservableObject {

    /// uid -> 最優先1件のバッジ。未取得のuidはこの辞書に存在しない(nilと区別しない。
    /// Web版のtopBadgeFor(uid)と同じくnilなら「バッジなし/未取得」として扱ってよい)。
    @Published private(set) var topBadges: [String: PTTAssignedBadge] = [:]
    /// [2026-08-04・次アクションitem4] uid -> 現在付与されている全バッジ(剥奪ボタンの
    /// 表示用)。Web版stores/badges.tsのbyUid(badges配列側)に相当。Guestの役割バッジ
    /// (source: "guest-role")は剥奪操作の対象外のため、呼び出し側でsource=="grant"のみ
    /// 表示に使うこと(ParticipantList.vueと同じ絞り込み)。
    @Published private(set) var allBadges: [String: [PTTAssignedBadge]] = [:]
    @Published var errorMessage: String?

    /// [2026-08-04・次アクションitem4] Room内owner向け付与UI。ownerでなければ常にnil
    /// (サーバー側がowner以外にはnullを返すため、クライアント側でrole判定を二重に
    /// 行う必要はない。UI側は「nilなら出さない」だけでよい。Web版stores/badges.tsの
    /// grantableBadgesと同じ設計)。
    @Published private(set) var grantableBadges: [PTTGrantableBadge]?
    @Published private(set) var isGranting = false
    @Published var grantErrorMessage: String?

    /// Web版 POLL_INTERVAL_MS と同じ間隔。
    private static let pollIntervalSeconds: TimeInterval = 20

    private var timer: Timer?
    private var fetchTask: Task<Void, Never>?

    // [2026-08-04] 付与/剥奪成功直後にポーリング間隔を待たず再取得するために保持する。
    private var currentTokenServerURL: String?
    private var currentRoomId: String?
    private var currentIdTokenProvider: (() async throws -> String)?

    private func performFetch(tokenServerURL: String, roomId: String, idToken: String) async throws -> PTTRoomBadgesResponse {
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
        return try JSONDecoder().decode(PTTRoomBadgesResponse.self, from: data)
    }

    private func applyResponse(_ decoded: PTTRoomBadgesResponse) {
        topBadges = decoded.members.compactMapValues { $0.topBadge }
        allBadges = decoded.members.mapValues { $0.badges }
        grantableBadges = decoded.grantableBadges
    }

    private func fetchOnce(tokenServerURL: String, roomId: String, idTokenProvider: @escaping () async throws -> String) {
        fetchTask?.cancel()
        fetchTask = Task { [weak self] in
            guard let self else { return }
            do {
                let idToken = try await idTokenProvider()
                let decoded = try await self.performFetch(tokenServerURL: tokenServerURL, roomId: roomId, idToken: idToken)
                guard !Task.isCancelled else { return }
                self.applyResponse(decoded)
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
        currentTokenServerURL = tokenServerURL
        currentRoomId = roomId
        currentIdTokenProvider = idTokenProvider
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
        allBadges = [:]
        grantableBadges = nil
        errorMessage = nil
        grantErrorMessage = nil
        currentTokenServerURL = nil
        currentRoomId = nil
        currentIdTokenProvider = nil
    }

    func topBadge(for uid: String) -> PTTAssignedBadge? {
        topBadges[uid]
    }

    /// [2026-08-04・次アクションitem4] Room内owner専用の手動付与。
    /// POST /:roomId/members/:targetUid/badges(routes/roomBadges.js)を叩く。
    /// サーバー側はさらに対象バッジのgrantableByRoomOwnerフラグを検証するため、
    /// クライアント側は「選択肢(grantableBadges)に出ているものだけを叩く」以上の
    /// 権限チェックを重複実装しない(ban機能と同じくサーバーを信頼する設計)。
    func grantBadge(tokenServerURL: String, idToken: String, roomId: String, targetUid: String, badgeId: String) async throws {
        let encodedTargetUid = targetUid.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? targetUid
        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/members/\(encodedTargetUid)/badges") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["badgeId": badgeId])

        try await performMutation(request: request, tokenServerURL: tokenServerURL, roomId: roomId)
    }

    /// Room内owner専用の手動剥奪(DELETE /:roomId/members/:targetUid/badges/:badgeId)。
    func revokeBadge(tokenServerURL: String, idToken: String, roomId: String, targetUid: String, badgeId: String) async throws {
        let encodedRoomId = roomId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? roomId
        let encodedTargetUid = targetUid.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? targetUid
        let encodedBadgeId = badgeId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? badgeId
        guard let url = URL(string: "\(tokenServerURL)/rooms/\(encodedRoomId)/members/\(encodedTargetUid)/badges/\(encodedBadgeId)") else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")

        try await performMutation(request: request, tokenServerURL: tokenServerURL, roomId: roomId)
    }

    private func performMutation(request: URLRequest, tokenServerURL: String, roomId: String) async throws {
        isGranting = true
        grantErrorMessage = nil
        defer { isGranting = false }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200...201).contains(http.statusCode) else {
            let message = try? JSONDecoder().decode(PTTBadgeErrorResponse.self, from: data).error
            let error = PTTBadgeAPIError.serverError(statusCode: http.statusCode, message: message)
            grantErrorMessage = error.errorDescription
            throw error
        }

        // Web版・Android版と同じく、成功後はポーリング間隔を待たず即座に再取得してUIへ
        // 反映する。再取得自体の失敗はここでは無視する(次回ポーリングに任せる)。
        if let idTokenProvider = currentIdTokenProvider,
           let idToken = try? await idTokenProvider(),
           let decoded = try? await performFetch(tokenServerURL: tokenServerURL, roomId: roomId, idToken: idToken) {
            applyResponse(decoded)
        }
    }
}
