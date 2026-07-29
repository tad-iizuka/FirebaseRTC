//
//  PTTSettingsStore.swift
//  ptt-ios
//
//  [接続先設定 — 設定画面への移設(2026-07-29)]
//  従来はContentView内の@State(tokenServerURL/livekitURL)としてのみ保持しており、
//  UserDefaultsへの永続化もされていなかった(アプリ再起動のたびに本番URLへ戻っていた)。
//  Web版(ptt-client/src/stores/settings.ts)に合わせ、
//    - プリセット(production/custom)方式にしてtypo事故を減らす
//    - 端末単位でUserDefaultsへ永続化する
//    - 通常画面(authSection/roomSelectionSection)からは撤去し、設定画面へ集約する
//  という3点を揃えた。Web版のPRESETS定数と同じ値を持つ(値がズレないよう、
//  値を変える場合はWeb版stores/settings.tsのPRESETS.productionと同時に変更すること)。
//

import Foundation
import Combine

enum PTTServerPreset: String {
    case production
    case custom
}

@MainActor
final class PTTSettingsStore: ObservableObject {

    static let productionTokenServerURL = "https://ptt-token-server-rnn4fqay3a-an.a.run.app"
    static let productionLivekitURL = "wss://ubunifu-talk-wy19xst3.livekit.cloud"

    private static let presetKey = "ptt.serverPresetId"
    private static let customTokenServerURLKey = "ptt.customTokenServerUrl"
    private static let customLivekitURLKey = "ptt.customLivekitUrl"

    @Published var presetId: PTTServerPreset {
        didSet { UserDefaults.standard.set(presetId.rawValue, forKey: Self.presetKey) }
    }
    @Published var customTokenServerURL: String {
        didSet { UserDefaults.standard.set(customTokenServerURL, forKey: Self.customTokenServerURLKey) }
    }
    @Published var customLivekitURL: String {
        didSet { UserDefaults.standard.set(customLivekitURL, forKey: Self.customLivekitURLKey) }
    }

    init() {
        let rawPreset = UserDefaults.standard.string(forKey: Self.presetKey) ?? PTTServerPreset.production.rawValue
        presetId = PTTServerPreset(rawValue: rawPreset) ?? .production
        customTokenServerURL = UserDefaults.standard.string(forKey: Self.customTokenServerURLKey) ?? Self.productionTokenServerURL
        customLivekitURL = UserDefaults.standard.string(forKey: Self.customLivekitURLKey) ?? Self.productionLivekitURL
    }

    /// 実際に接続に使う値。呼び出し側(ContentView等)はこれまで通り
    /// tokenServerURL/livekitURLだけを見ればよい(プリセット/カスタムの分岐はここに閉じ込める)。
    var tokenServerURL: String {
        presetId == .custom ? customTokenServerURL : Self.productionTokenServerURL
    }
    var livekitURL: String {
        presetId == .custom ? customLivekitURL : Self.productionLivekitURL
    }

    func resetToDefault() {
        presetId = .production
    }
}
