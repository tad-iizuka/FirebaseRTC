//
//  PTTAppCheckProvider.swift
//  ptt-ios
//
//  [Phase14] Firebase App Check対応。
//
//  [背景] token-server側のmiddleware/requireAppCheck.js(soft-enforce)と
//  対になる、iOS版の送信側実装。実機(iOS 14+)ではApp Attestプロバイダを使う。
//  シミュレータはApp Attestに対応していないため、DEBUGビルドかつ
//  シミュレータ実行時のみDeviceCheckProviderFactory(のAppCheckDebugProvider相当)
//  にフォールバックする設計とし、ローカル開発でシミュレータを使う場合でも
//  ビルド・起動自体は妨げないようにする。
//
//  [適用箇所] ptt_iosApp.swift の init() 内、FirebaseApp.configure() より前で
//  AppCheck.setAppCheckProviderFactory(PTTAppCheckProviderFactory()) を呼ぶ。
//

import Foundation
import FirebaseCore
import FirebaseAppCheck

final class PTTAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        #if targetEnvironment(simulator)
        // シミュレータはSecure Enclaveが無くApp Attestを使えないため、
        // デバッグプロバイダにフォールバックする。デバッグトークンは
        // 初回起動時のコンソールログに出力されるので、Firebase Consoleの
        // 「App Check > アプリ > デバッグトークンを管理」に登録すること。
        return AppCheckDebugProvider(app: app)
        #else
        if #available(iOS 14.0, *) {
            return AppAttestProvider(app: app)
        } else {
            // iOS 14未満(App Attest非対応)向けのフォールバック。
            return DeviceCheckProvider(app: app)
        }
        #endif
    }
}

/// token-serverへのリクエストに付与するApp Checkトークンを取得するヘルパー。
/// 各Store(PTTRoomManager等)は自身のリクエスト組み立て箇所でこれを呼び出す
/// (idTokenと同様、呼び出し側で都度取得する既存のパターンを踏襲)。
/// soft-enforce運用のため、取得に失敗してもエラーを投げず nil を返し、
/// 呼び出し側はヘッダーを付けずにリクエストを継続する。
enum PTTAppCheck {
    static func token() async -> String? {
        do {
            let result = try await AppCheck.appCheck().token(forcingRefresh: false)
            return result.token
        } catch {
            print("[AppCheckトークン取得失敗]", error)
            return nil
        }
    }
}
