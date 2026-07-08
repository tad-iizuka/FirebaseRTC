/**
 * PTTModels.kt
 *
 * [LiveKit移行]
 * iOS版(PTTModels.swift)と同じく、シグナリングはLiveKit SDKが担うため
 * UI表示用の接続状態だけを保持する。
 */
package co.ubunifu.pttandroid.model

sealed class ConnectionStatus {
    data object Disconnected : ConnectionStatus()
    data object Connecting : ConnectionStatus()
    data class Connected(val room: String) : ConnectionStatus()

    /** 接続済みだったが、ネットワーク問題等でLiveKit SDKが自動的に再接続を試行中 */
    data class Reconnecting(val room: String) : ConnectionStatus()
    data class Error(val message: String) : ConnectionStatus()
}

/** 参加者1人分のUI表示用状態(名前・マイクmute状態) */
data class ParticipantInfo(
    val identity: String,
    val name: String,
    val muted: Boolean,
)

/** rooms/{roomId}/messages の1件分(Web版・iOS版と同じスキーマ) */
data class ChatMessage(
    val id: String,
    val uid: String,
    val displayName: String,
    val text: String,
    val createdAtMillis: Long?,
)
