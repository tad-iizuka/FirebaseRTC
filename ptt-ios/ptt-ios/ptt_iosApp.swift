//
//  ptt_iosApp.swift
//  ptt-ios
//
//  Created by Tadashi on 2026/06/21.
//

import SwiftUI
import AVFAudio

@main
struct ptt_iosApp: App {

    init() {
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
        }
    }
}
