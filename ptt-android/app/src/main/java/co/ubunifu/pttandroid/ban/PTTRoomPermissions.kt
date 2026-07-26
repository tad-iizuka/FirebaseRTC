/**
 * PTTRoomPermissions.kt
 *
 * [Phase12・十五訂] token-server/lib/permissions.js の対応表(ROOM_OPERATIONS)の
 * うち、このクライアントが実際に参照している値だけをこの1ファイルに集約する。
 *
 * このクライアントでrole分岐が必要な操作(BAN実行・録音の開始/停止)は、
 * サーバー側では 'members:ban' / 'recording:start' / 'recording:stop' として
 * 定義されており、いずれも許可roleは ['owner', 'moderator'] で揃っている
 * (owner単独・moderator単独を区別する分岐はクライアント側に存在しない)。
 *
 * [同期方針(brushup-plan.md Phase12・十五訂で確定)]
 * サーバーの対応表を実行時にAPIとして配信する方式は採らず、この定数を
 * サーバー側の値と手動で一致させる運用とする。この一致は
 * scripts/check-role-sync.js がCI上で機械的に検証するため、
 * token-server/lib/permissions.js 側で該当操作のrole構成を変更した場合は、
 * 必ずこのファイル・roomPermissions.ts(Web)・PTTRoomPermissions.swift(iOS)
 * の3箇所すべてを同時に更新すること。
 *
 * ここで扱わないrole分岐:
 * - Room作成ボタンの表示可否は role ではなく isAnonymous(Firebase Auth)で
 *   判定する(PTTApp.kt参照)。未入室(=Roomメンバーではない)画面では
 *   role という概念自体が存在しないため、この対象外。
 */
package co.ubunifu.pttandroid.ban

object PTTRoomPermissions {
    val MANAGE_ROLES: Set<String> = setOf("owner", "moderator")

    /** BAN実行・録音の開始/停止など、owner/moderatorのみに許可されたUIの表示可否判定に使う。 */
    fun canManageRoom(role: String?): Boolean = role != null && MANAGE_ROLES.contains(role)
}
