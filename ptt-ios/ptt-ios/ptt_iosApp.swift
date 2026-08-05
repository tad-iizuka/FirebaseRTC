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

        // LiveKit SDKはデフォルトでAVAudioSessionを自動管理するが、Bluetoothヘッドセットの
        // マイクを優先させる設定(.allowBluetooth等)を明示的に固定したいため、自動管理を無効化し
        // アプリ側でカテゴリ・エンジンの利用可否を制御する。
        // [CallKit統合を撤回(2026-07-30)] 以前はここでCXProviderのdidActivateを待つために
        // エンジンを.noneのまま起動していたが、CallKit連携自体を撤回したため、
        // 通常通り起動時から.defaultにしてセッションをアクティブ化する。
        AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true)
            try AudioManager.shared.setEngineAvailability(.default)
        } catch {
            print(error)
        }
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
