//
//  PTTSettingsView.swift
//  ptt-ios
//
//  [設定画面] Web版 ptt-client/src/components/SettingsDialog.vue の移植。
//  従来ContentView(roomSelectionSection)に直接置かれていた
//  トークンサーバーURL/LiveKit URLの入力フィールドをここへ集約する。
//  歯車アイコン(PTTSettingsIcon)からシートとして開く。
//
//  ダイアログを開いている間はローカルの下書き(draft*)で編集し、
//  「保存」を押すまでストア(PTTSettingsStore)へは反映しない。
//  Escで閉じる操作がないiOSでは「キャンセル」ボタンがそれに相当する。
//

import SwiftUI

struct PTTSettingsView: View {
    @ObservedObject var settings: PTTSettingsStore
    @Environment(\.dismiss) private var dismiss

    @State private var draftPresetId: PTTServerPreset
    @State private var draftTokenServerURL: String
    @State private var draftLivekitURL: String

    init(settings: PTTSettingsStore) {
        self.settings = settings
        _draftPresetId = State(initialValue: settings.presetId)
        _draftTokenServerURL = State(initialValue: settings.customTokenServerURL)
        _draftLivekitURL = State(initialValue: settings.customLivekitURL)
    }

    private var isTokenServerURLValid: Bool {
        draftPresetId != .custom || draftTokenServerURL.trimmingCharacters(in: .whitespaces).hasPrefix("https://")
    }
    private var isLivekitURLValid: Bool {
        draftPresetId != .custom || draftLivekitURL.trimmingCharacters(in: .whitespaces).hasPrefix("wss://")
    }
    private var canSave: Bool { isTokenServerURLValid && isLivekitURLValid }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(String(localized: "サーバー接続"), selection: $draftPresetId) {
                        Text(String(localized: "本番(デフォルト)")).tag(PTTServerPreset.production)
                        Text(String(localized: "カスタム")).tag(PTTServerPreset.custom)
                    }
                    .pickerStyle(.inline)
                } header: {
                    Text(String(localized: "サーバー接続"))
                }

                if draftPresetId == .custom {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            TextField(String(localized: "トークンサーバーURL"), text: $draftTokenServerURL)
                                .font(.system(size: 14, design: .monospaced))
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                            if !isTokenServerURLValid {
                                Text(String(localized: "https:// から始まるURLを入力してください"))
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.pttDanger)
                            }
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            TextField(String(localized: "LiveKit URL (wss://)"), text: $draftLivekitURL)
                                .font(.system(size: 14, design: .monospaced))
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                            if !isLivekitURLValid {
                                Text(String(localized: "wss:// から始まるURLを入力してください"))
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.pttDanger)
                            }
                        }
                    }
                }

                Section {
                    Button(String(localized: "デフォルトに戻す")) {
                        draftPresetId = .production
                        draftTokenServerURL = PTTSettingsStore.productionTokenServerURL
                        draftLivekitURL = PTTSettingsStore.productionLivekitURL
                    }
                }

                Section {
                    Text(String(localized: "変更は次回の接続から反映されます。"))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.pttMuted)
                }
            }
            .navigationTitle(String(localized: "設定"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "キャンセル")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "実行する")) {
                        settings.presetId = draftPresetId
                        if draftPresetId == .custom {
                            settings.customTokenServerURL = draftTokenServerURL.trimmingCharacters(in: .whitespaces)
                            settings.customLivekitURL = draftLivekitURL.trimmingCharacters(in: .whitespaces)
                        }
                        dismiss()
                    }
                    .disabled(!canSave)
                }
            }
        }
    }
}
