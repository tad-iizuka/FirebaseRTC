//
//  ptt_iosApp.swift
//  ptt-ios
//
//  Created by Tadashi on 2026/06/21.
//

import SwiftUI
import AVFAudio
import FirebaseCore
import FirebaseAppCheck
import GoogleSignIn
import LiveKit

@main
struct ptt_iosApp: App {

    init() {
        // [Phase14] App Checkプロバイダの登録は FirebaseApp.configure() より
        // 前に行う必要がある(登録が後だと反映されない)。詳細は
        // PTTAppCheckProvider.swift 参照。
        AppCheck.setAppCheckProviderFactory(PTTAppCheckProviderFactory())

        // GoogleService-Info.plist を読み込んでFirebaseを初期化する。
        // このファイルはFirebase Consoleからダウンロードして
        // Xcodeプロジェクトに追加しておく必要がある(リポジトリには含めない)。
        FirebaseApp.configure()

        // Let LiveKit configure and activate the session on its audio engine queue.
        // Its default playAndRecord configuration supports Bluetooth and speaker output.
        AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = true

    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    // [招待リンク] SwiftUIのonOpenURLはカスタムURLスキーム(Googleサインイン
                    // のリダイレクト)とUniversal Link(https://.../r?room=...&code=...)の
                    // 両方をこの1箇所で受け取る。まずGoogleサインインとして処理させ、
                    // 該当しなければ招待リンクとしてパースを試みる(deeplink-qr-join-plan.md参照)。
                    if GIDSignIn.sharedInstance.handle(url) {
                        return
                    }
                    if let invite = parseInviteURL(url) {
                        PTTPendingInviteStore.shared.set(invite)
                    }
                }
        }
    }
}
