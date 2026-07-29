//
//  ConnectionStatusIcon.swift
//  ptt-ios
//
//  [接続状態のアイコン化] Web版 ptt-client/src/components/ConnectionStatusIcon.vue の移植。
//  以前はヘッダー右端に "room: xxxx" / "未接続" というテキストをそのまま表示していたが、
//  Web版に合わせて丸いアイコン1個に統一する。
//  connected/reconnecting はどちらもルームIDの頭文字を表示し(見た目の区別は色のみ)、
//  それ以外(disconnected/connecting/error)は「未接続」として wifi.slash アイコンで表す。
//  ルーム内で表示される statusRow(色付きドット+詳細テキスト)は据え置きで、
//  このアイコンはヘッダー専用の要約表示。
//

import SwiftUI

struct ConnectionStatusIcon: View {
    let status: ConnectionStatus

    // Web版の `animate-pulse`(Tailwind)に相当。reconnecting中だけ不透明度を往復させる。
    @State private var pulse = false

    private var roomId: String? {
        switch status {
        case .connected(let room): return room
        case .reconnecting(let room): return room
        case .disconnected, .connecting, .error: return nil
        }
    }

    private var isLive: Bool {
        switch status {
        case .connected, .reconnecting: return true
        case .disconnected, .connecting, .error: return false
        }
    }

    private var isReconnecting: Bool {
        if case .reconnecting = status { return true }
        return false
    }

    // サロゲートペア対策で先頭の Character をそのまま使う(Web版の配列展開と同じ意図)。
    private var initial: String {
        guard let roomId, let first = roomId.first else { return "" }
        return String(first).uppercased()
    }

    private var tint: Color {
        isReconnecting ? .pttWarning : .pttLive
    }

    private var label: String {
        if isLive, let roomId {
            return String(
                format: NSLocalizedString("接続中 (room=%@)", comment: "Connection status icon accessibility label"),
                roomId
            )
        }
        return String(localized: "未接続")
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(isLive ? tint.opacity(0.15) : Color.clear)
            Circle()
                .strokeBorder(
                    isLive ? tint.opacity(0.4) : Color.pttMuted.opacity(0.35),
                    style: StrokeStyle(lineWidth: 1, dash: isLive ? [] : [3, 2])
                )
            if isLive {
                Text(initial)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundColor(tint)
            } else {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.pttMuted)
            }
        }
        .frame(width: 28, height: 28)
        .opacity(isReconnecting && pulse ? 0.45 : 1)
        .onAppear { startPulseIfNeeded() }
        .onChange(of: isReconnecting) { _, _ in startPulseIfNeeded() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private func startPulseIfNeeded() {
        guard isReconnecting else {
            pulse = false
            return
        }
        withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
            pulse = true
        }
    }
}
