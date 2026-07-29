//
//  PTTSettingsIcon.swift
//  ptt-ios
//
//  [設定アイコン] Web版 ptt-client/src/components/SettingsIcon.vue の移植。
//  headerに常時表示することで、未サインイン/サインイン後どちらの画面からも
//  同じ設定(現状はサーバー接続先のみ)へたどり着けるようにする。
//

import SwiftUI

struct PTTSettingsIcon: View {
    @ObservedObject var settings: PTTSettingsStore
    @State private var isPresented = false

    var body: some View {
        Button {
            isPresented = true
        } label: {
            ZStack {
                Circle().fill(Color.pttPanel)
                Circle().strokeBorder(Color.pttLine, lineWidth: 1)
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 11))
                    .foregroundColor(.pttMuted)
            }
            .frame(width: 28, height: 28)
        }
        .accessibilityLabel(String(localized: "設定"))
        .sheet(isPresented: $isPresented) {
            PTTSettingsView(settings: settings)
        }
    }
}
