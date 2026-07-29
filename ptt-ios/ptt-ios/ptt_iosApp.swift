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
import LiveKit

@main
struct ptt_iosApp: App {

    init() {
        // GoogleService-Info.plist を読み込んでFirebaseを初期化する。
        // このファイルはFirebase Consoleからダウンロードして
        // Xcodeプロジェクトに追加しておく必要がある(リポジトリには含めない)。
        FirebaseApp.configure()

        // LiveKit SDKはデフォルトでAVAudioSessionを自動管理し、Room接続時や
        // マイク発行時にアプリの設定を上書きしてしまう。CallKit(PTTCallKitManager)と
        // 連携させるため、自動管理を無効化し、セッション設定・音声エンジンの
        // 起動可否を常にアプリ/CallKit側で明示的に制御する。
        AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            // setActive(true)はここでは呼ばない。CallKit自身がCXProviderの
            // didActivate(_:)でオーディオセッションをアクティブ化するため
            // (LiveKit公式のCallKit統合パターンに準拠)。
            try AudioManager.shared.setEngineAvailability(.none)
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
