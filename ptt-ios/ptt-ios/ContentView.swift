//
//  ContentView.swift
//  PTTClient
//
//  [LiveKit移行]
//  Web版(ptt-client/public/index.html)のLiveKit版と同等のUI:
//  接続フォーム(トークンサーバーURL / LiveKit URL / ルームID / クライアントID)
//  → PTTボタン → 送話中リスト → ログ
//

import SwiftUI

struct ContentView: View {

    @StateObject private var connection = PTTConnectionManager()

    @State private var tokenServerURL: String = "https://ptt-token-server-rnn4fqay3a-an.a.run.app"
    @State private var livekitURL: String = "wss://ubunifu-talk-wy19xst3.livekit.cloud"
    @State private var roomId: String = "room1"
    @State private var clientId: String = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header
                statusRow
                form
                talkArea
                talkerSection
                logSection
            }
        }
        .background(Color(red: 0.05, green: 0.07, blue: 0.06))
        .foregroundColor(Color(red: 0.85, green: 0.89, blue: 0.86))
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("PTT CLIENT")
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundColor(.gray)
            Spacer()
            Text(channelLabel)
                .font(.system(size: 13, design: .monospaced))
        }
        .padding(14)
    }

    private var channelLabel: String {
        switch connection.status {
        case .connected(let room): return "room: \(room)"
        default: return "未接続"
        }
    }

    // MARK: - Status

    private var statusRow: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            Text(statusText)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(.gray)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 10)
    }

    private var statusColor: Color {
        switch connection.status {
        case .connected: return Color(red: 0.24, green: 0.86, blue: 0.52)
        case .error: return Color(red: 1.0, green: 0.36, blue: 0.36)
        default: return .gray
        }
    }

    private var statusText: String {
        switch connection.status {
        case .disconnected: return "サーバ未接続"
        case .connecting: return "接続中..."
        case .connected(let room): return "接続中 (room=\(room))"
        case .error(let message): return "エラー: \(message)"
        }
    }

    // MARK: - Form

    private var form: some View {
        VStack(spacing: 10) {
            field(label: "トークンサーバーURL", text: $tokenServerURL)
            field(label: "LiveKit URL (wss://)", text: $livekitURL)
            HStack(spacing: 10) {
                field(label: "ルームID", text: $roomId)
                field(label: "クライアントID", text: $clientId, placeholder: "例: alice")
            }
            Button(action: toggleConnection) {
                Text(isConnected ? "切断する" : "接続する")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
            }
            .buttonStyle(.plain)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .stroke(Color.orange, lineWidth: 1)
            )
            .foregroundColor(.orange)
            .disabled(connection.status == .connecting)
        }
        .padding(14)
    }

    private func field(label: String, text: Binding<String>, placeholder: String = "") -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.gray)
            TextField(placeholder, text: text)
                .font(.system(size: 14, design: .monospaced))
                .padding(8)
                .background(Color.black.opacity(0.3))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
    }

    private var isConnected: Bool {
        if case .connected = connection.status { return true }
        return false
    }

    private func toggleConnection() {
        if isConnected {
            connection.disconnect()
        } else {
            guard !tokenServerURL.isEmpty, !livekitURL.isEmpty, !roomId.isEmpty, !clientId.isEmpty else { return }
            connection.connect(tokenServerURL: tokenServerURL, livekitURL: livekitURL, room: roomId, identity: clientId)
        }
    }

    // MARK: - Talk area (PTT button)

    private var talkArea: some View {
        VStack(spacing: 14) {
            Circle()
                .strokeBorder(connection.isSending ? Color.orange : Color.gray.opacity(0.4), lineWidth: 2)
                .background(Circle().fill(Color.black.opacity(0.3)))
                .frame(width: 150, height: 150)
                .overlay(
                    Text(connection.isSending ? "送話中" : "押して送話")
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundColor(connection.isSending ? .orange : .gray)
                )
                .scaleEffect(connection.isSending ? 0.97 : 1.0)
                .opacity(isConnected ? 1.0 : 0.3)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in connection.startTalking() }
                        .onEnded { _ in connection.stopTalking() }
                )
                .allowsHitTesting(isConnected)

            Text("ボタンを押している間だけ音声が送信されます")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.gray)
        }
        .padding(.vertical, 24)
    }

    // MARK: - Talkers

    private var talkerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("送話中")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.gray)

            if connection.talkers.isEmpty {
                chip(text: "— なし —", live: false)
            } else {
                FlowLayoutHStackFallback(items: Array(connection.talkers))
            }
        }
        .padding(14)
    }

    private func chip(text: String, live: Bool) -> some View {
        Text(text)
            .font(.system(size: 11, design: .monospaced))
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .overlay(
                Capsule().stroke(live ? Color(red: 0.24, green: 0.86, blue: 0.52) : Color.gray.opacity(0.4))
            )
            .foregroundColor(live ? Color(red: 0.24, green: 0.86, blue: 0.52) : .gray)
    }

    // MARK: - Log

    private var logSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(connection.logLines.suffix(50), id: \.self) { line in
                Text(line)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(.gray)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// シンプルな折り返しチップ表示（iOS17のWrappingHStack代替の簡易実装）
private struct FlowLayoutHStackFallback: View {
    let items: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items, id: \.self) { id in
                    Text(id)
                        .font(.system(size: 11, design: .monospaced))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .overlay(
                            Capsule().stroke(Color(red: 0.24, green: 0.86, blue: 0.52))
                        )
                        .foregroundColor(Color(red: 0.24, green: 0.86, blue: 0.52))
                }
            }
        }
    }
}

#Preview {
    ContentView()
}
