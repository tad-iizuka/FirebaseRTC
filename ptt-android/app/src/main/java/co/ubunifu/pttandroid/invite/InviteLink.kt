/**
 * InviteLink.kt
 *
 * 招待リンク(Universal Link/App Link)・QRコードの共通パース処理。
 * フォーマットはWeb版(ptt-client/src/lib/inviteLink.ts)・iOS版(InviteLink.swift)と
 * 一致させること: https://<ptt-clientのホスト>/r?room=<roomId>&code=<inviteCode>
 *
 * この値を受け取った側は、入力欄への反映のみを行い、自動参加はしない
 * (deeplink-qr-join-plan.md参照)。
 */
package co.ubunifu.pttandroid.invite

import android.net.Uri

data class PendingInvite(val roomId: String, val inviteCode: String)

/** App Link起動時のIntent.dataや、QRスキャナーが読み取った生文字列の両方に使う。 */
fun parseInviteUri(uri: Uri?): PendingInvite? {
    if (uri == null) return null
    val roomId = uri.getQueryParameter("room")
    val inviteCode = uri.getQueryParameter("code")
    if (roomId.isNullOrBlank() || inviteCode.isNullOrBlank()) return null
    return PendingInvite(roomId = roomId, inviteCode = inviteCode)
}

fun parseInviteText(text: String): PendingInvite? = try {
    parseInviteUri(Uri.parse(text))
} catch (_: Exception) {
    null
}
