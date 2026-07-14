//
//  PTTOnboardingStore.swift
//  PTTClient
//
//  [オンボーディング]
//  Web版(ptt-client/src/stores/onboarding.ts)と同じ設計判断: 初回起動時に
//  アプリの使い方を紹介するスワイプ形式のチュートリアルを見せたかどうかを
//  UserDefaultsに永続化する。サインイン前の初回起動者にも見せたいため、
//  PTTSavedRoomsStoreのようにuidごとにキーを分けず、端末(アプリ)単位で
//  1つのフラグとして保持する(「このアプリを一度でも起動したか」だけが
//  関心事のため)。
//

import Foundation
import Combine

@MainActor
final class PTTOnboardingStore: ObservableObject {

    private static let storageKey = "pttOnboardingCompleted"

    @Published private(set) var hasCompletedOnboarding: Bool

    init() {
        hasCompletedOnboarding = UserDefaults.standard.bool(forKey: Self.storageKey)
    }

    func complete() {
        hasCompletedOnboarding = true
        UserDefaults.standard.set(true, forKey: Self.storageKey)
    }

    /// 開発中の動作確認用。本番UIからは呼ばない想定。
    func reset() {
        hasCompletedOnboarding = false
        UserDefaults.standard.removeObject(forKey: Self.storageKey)
    }
}
