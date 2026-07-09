//
//  PTTModels.swift
//  PTTClient
//
//  [LiveKit移行]
//  以前は server.js とやり取りする自前のJSON制御メッセージ
//  (join/leave/ptt_start/ptt_end/joined/member_joined 等) をここで定義していたが、
//  LiveKit移行によりシグナリングはすべてLiveKit SDKが担うため不要になった。
//  UI表示用の接続状態だけを残す。
//

import Foundation

/// 接続状態（UI表示用）
enum ConnectionStatus: Equatable {
    case disconnected
    case connecting
    case connected(room: String)
    /// 接続済みだったが、ネットワーク問題で再接続を試行中(LiveKit SDKが自動的に行う)。
    /// quick(ICE再起動)/full(再接続)どちらのモードでも遷移する。
    case reconnecting(room: String)
    case error(String)
}

/// [BAN対応] 参加者1人分のUI表示用状態（名前・マイクmute状態）。
/// Web版の `participants` Map（uid -> {name, muted}）に相当し、
/// 参加者リストの表示とBAN対象の指定の両方に使う。ローカル参加者(自分)は含めない。
struct PTTParticipantInfo: Identifiable, Equatable {
    let uid: String
    var name: String
    var isMuted: Bool
    var id: String { uid }
}
