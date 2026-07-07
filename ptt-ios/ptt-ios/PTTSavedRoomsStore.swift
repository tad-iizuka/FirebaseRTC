//
//  PTTSavedRoomsStore.swift
//  PTTClient
//
//  [よく使うルームの保存]
//  token-serverにはルーム一覧を返すAPIが無い(招待制のため「一覧」という概念が薄い)。
//  そのため、あくまで「自分が過去に作成/参加したルームにワンタップで戻れる」ための
//  ローカルな履歴としてUserDefaultsに保存する。
//  複数のFirebaseアカウントで同じ端末を使うケースを考慮し、
//  uidごとに別のUserDefaultsキーに保存する(サインアウト/別アカウントでの汚染を防ぐ)。
//
//  Web版(ptt-client/public/index.html)のlocalStorage実装と同じデータモデル・方針。
//

import Foundation
import Combine

@MainActor
final class PTTSavedRoomsStore: ObservableObject {

    struct SavedRoom: Codable, Identifiable, Equatable {
        var id: String { roomId }
        let roomId: String
        var label: String
        /// 自分がowner(作成者)の場合のみ非nil。再入室時に招待コードを再表示するために保持する。
        var inviteCode: String?
        var lastUsedAt: Date
    }

    @Published private(set) var rooms: [PTTSavedRoomsStore.SavedRoom] = []

    private var storageKey: String?
    private let maxCount = 20

    /// サインイン中のuidに応じてストレージキーを切り替え、そのユーザーの履歴を読み込む。
    /// サインアウト時は uid: nil で呼び、一覧を空にする。
    func load(forUid uid: String?) {
        guard let uid else {
            storageKey = nil
            rooms = []
            return
        }
        let key = "pttSavedRooms:\(uid)"
        storageKey = key
        guard let data = UserDefaults.standard.data(forKey: key) else {
            rooms = []
            return
        }
        rooms = (try? JSONDecoder().decode([SavedRoom].self, from: data)) ?? []
    }

    /// ルーム作成/参加のたびに呼ぶ。同じroomIdが既にあれば更新して先頭に移動する。
    func upsert(roomId: String, label: String, inviteCode: String?) {
        guard storageKey != nil else { return }
        var updated = rooms.filter { $0.roomId != roomId }
        updated.insert(SavedRoom(roomId: roomId, label: label, inviteCode: inviteCode, lastUsedAt: Date()), at: 0)
        if updated.count > maxCount {
            updated = Array(updated.prefix(maxCount))
        }
        rooms = updated
        persist()
    }

    func remove(roomId: String) {
        guard storageKey != nil else { return }
        rooms.removeAll { $0.roomId == roomId }
        persist()
    }

    private func persist() {
        guard let key = storageKey, let data = try? JSONEncoder().encode(rooms) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
