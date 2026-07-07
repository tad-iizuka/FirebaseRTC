//
//  ptt_iosApp.swift
//  ptt-ios
//
//  Created by Tadashi on 2026/06/21.
//

import SwiftUI
import AVFAudio
import FirebaseCore
import GoogleSignIn

@main
struct ptt_iosApp: App {

    init() {
        // GoogleService-Info.plist を読み込んでFirebaseを初期化する。
        // このファイルはFirebase Consoleからダウンロードして
        // Xcodeプロジェクトに追加しておく必要がある(リポジトリには含めない)。
        FirebaseApp.configure()

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth]
            )
            try session.setActive(true)
        } catch {
            print(error)
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    // Googleサインインのリダイレクトを受け取るために必要。
                    // Info.plistのCFBundleURLTypesにREVERSED_CLIENT_IDを
                    // 登録しておかないとリダイレクトが戻ってこない。
                    GIDSignIn.sharedInstance.handle(url)
                }
        }
    }
}
