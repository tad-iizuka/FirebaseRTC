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

/**
 * [Phase16] rooms/{roomId}/messages/{messageId}.attachment のFirestore形状
 * (Web版 ptt-client/src/types/api.ts の ChatAttachment と同じフィールド構成)。
 * kindはtoken-server/lib/attachments.jsのCONTENT_TYPE_KINDが返す文字列
 * ("image"|"video"|"pdf")を反映する。未知の値はUNKNOWNへフォールバックする。
 */
enum class AttachmentKind {
    IMAGE, VIDEO, PDF, UNKNOWN;

    companion object {
        fun fromWire(value: String?): AttachmentKind = when (value) {
            "image" -> IMAGE
            "video" -> VIDEO
            "pdf" -> PDF
            else -> UNKNOWN
        }
    }
}

data class ChatAttachment(
    val storagePath: String,
    val thumbnailPath: String?,
    val contentType: String,
    val kind: AttachmentKind,
    val fileName: String,
    val size: Long,
)

/** rooms/{roomId}/messages の1件分(Web版・iOS版と同じスキーマ) */
data class ChatMessage(
    val id: String,
    val uid: String,
    val displayName: String,
    val text: String,
    val createdAtMillis: Long?,
    // [Phase16] 添付が無いメッセージはnull
    val attachment: ChatAttachment? = null,
)

/**
 * [Phase13] GET /rooms/:roomId/badges のレスポンス内、1バッジ分。
 * Web版(ptt-client/src/types/api.ts の AssignedBadge)と同じフィールド構成。
 * category は "role" | "skill" | "unit" | "rank" | "other"、
 * source は "grant" | "guest-role"(Web版と同じ文字列をそのまま保持し、
 * UI側での分岐には現状使わないためenum化はしていない)。
 */
data class AssignedBadge(
    val badgeId: String,
    val name: String,
    val icon: String,
    val category: String,
    val priority: Int,
    val source: String,
)

/** GET /rooms/:roomId/badges の members[uid] 1件分(Web版のRoomMemberBadgesと同じ) */
data class RoomMemberBadges(
    val badges: List<AssignedBadge>,
    val topBadge: AssignedBadge?,
)

/**
 * [2026-08-04・次アクションitem4] Room内owner向け「付与できるバッジ」の選択肢。
 * Web版(ptt-client/src/types/api.ts の GrantableBadge)と同じフィールド構成。
 * owner以外にはサーバー側からnullが返る(lib/badges.js listRoomOwnerGrantableBadges参照)。
 */
data class GrantableBadge(
    val badgeId: String,
    val name: String,
    val icon: String,
    val category: String,
)
