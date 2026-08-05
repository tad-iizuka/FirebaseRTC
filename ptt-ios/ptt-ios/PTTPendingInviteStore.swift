//
//  PTTPendingInviteStore.swift
//  ptt-ios
//
//  [招待リンク] ptt_iosApp.swiftのonOpenURL(Universal Link受信)は
//  ContentViewの@StateObject群にアクセスできない(ContentView自身がownerのため)。
//  そのため、シングルトンで一時的に橋渡しする。ContentView側は
//  PTTPendingInviteStore.sharedを@ObservedObjectとして監視し、値が来たら
//  入力欄へ反映してからconsume()で消費する(自動参加はしない。deeplink-qr-join-plan.md参照)。
//

import Foundation
import Combine

@MainActor
final class PTTPendingInviteStore: ObservableObject {
    static let shared = PTTPendingInviteStore()

    @Published private(set) var pendingInvite: PendingInvite?

    private init() {}

    func set(_ invite: PendingInvite) {
        pendingInvite = invite
    }

    /// ContentView側が入力欄へ反映し終えたら呼ぶ。
    func consume() {
        pendingInvite = nil
    }
}
