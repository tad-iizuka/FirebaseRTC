/**
 * PTTBanStore.kt
 *
 * [BAN対応]
 * Web版(ptt-client/public/index.html)・iOS版(PTTBanStore.swift)と同じ設計:
 *   - 自分の rooms/{roomId}/members/{uid} ドキュメントを読み、role(owner/moderator/member)を
 *     取得する。BANボタンの表示可否に使う。
 *   - 同じドキュメントをリアルタイム監視(addSnapshotListener)し、statusが'banned'に
 *     なった瞬間を検知する。BAN自体の強制力はLiveKit側の即時キック
 *     (token-server routes/rooms.js の RoomServiceClient.removeParticipant)が担うが、
 *     UI側でも「排除されました」と即座に表示するための補助。
 *   - BAN実行(POST /rooms/:roomId/members/:targetUid/ban)はowner/moderatorのみ
 *     サーバー側で許可される。クライアント側の role 表示はあくまでUI制御であり、
 *     実際の権限チェックはサーバーが行う。
 *
 * firestore.rules により、クライアントは自分自身の members/{uid} ドキュメントしか
 * 読み取れない(他人のロールやメンバー一覧は取得できない)。そのためBAN対象の一覧は
 * Firestoreではなく PTTConnectionManager.participants (LiveKitの実際の接続情報) を使う。
 */
package co.ubunifu.pttandroid.ban

import android.content.Context
import co.ubunifu.pttandroid.R
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class BanApiException(val statusCode: Int, message: String) : Exception(message)

class PTTBanStore(
    context: Context,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) {
    // [多言語化] エラーメッセージのローカライズ用。
    private val appContext = context.applicationContext
    private val db = FirebaseFirestore.getInstance()

    /** 現在入室中のルームでの自分のロール。"owner" | "moderator" | "member" | "guest" | null(未取得/不明) */
    private val _myRole = MutableStateFlow<String?>(null)
    val myRole: StateFlow<String?> = _myRole

    /**
     * [Phase10: Guestロール 5.1]
     * 自分自身の表示名(ニックネーム)。members/{uid}ドキュメントの一部なので、
     * BAN監視と同じonSnapshotリスナーに相乗りする形で追跡する。他人が変更した
     * 場合は関係ないため、「自分のニックネームが他端末等から変更された場合の
     * リアルタイム反映」用途(Web版stores/ban.tsのmyDisplayNameと同じ設計)。
     */
    private val _myDisplayName = MutableStateFlow<String?>(null)
    val myDisplayName: StateFlow<String?> = _myDisplayName

    /** 自分がこのルームからBANされたことを検知した場合にtrueになる */
    private val _isBanned = MutableStateFlow(false)
    val isBanned: StateFlow<Boolean> = _isBanned

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage

    private val _nicknameUpdating = MutableStateFlow(false)
    val nicknameUpdating: StateFlow<Boolean> = _nicknameUpdating

    private val _nicknameErrorMessage = MutableStateFlow<String?>(null)
    val nicknameErrorMessage: StateFlow<String?> = _nicknameErrorMessage

    private var listener: ListenerRegistration? = null

    /** ルーム入室時に呼ぶ。自分のロールを取得し、BAN状態のリアルタイム監視を開始する。 */
    fun start(roomId: String, uid: String) {
        stop()
        if (uid.isEmpty()) return

        val ref = db.collection("rooms").document(roomId).collection("members").document(uid)

        ref.get()
            .addOnSuccessListener { snap ->
                _myRole.value = if (snap.exists()) (snap.getString("role") ?: "member") else null
                _myDisplayName.value = if (snap.exists()) snap.getString("displayName") else null
            }
            .addOnFailureListener { e ->
                _errorMessage.value = appContext.getString(R.string.errors_role_fetch, e.message)
                _myRole.value = null
            }

        listener = ref.addSnapshotListener { snapshot, error ->
            if (error != null) {
                _errorMessage.value = appContext.getString(R.string.errors_ban_watch, error.message)
                return@addSnapshotListener
            }
            if (snapshot != null && snapshot.exists()) {
                if (snapshot.getString("status") == "banned") {
                    _isBanned.value = true
                }
                _myDisplayName.value = snapshot.getString("displayName")
            }
        }
    }

    /** ルーム退出時に呼ぶ。 */
    fun stop() {
        listener?.remove()
        listener = null
        _myRole.value = null
        _myDisplayName.value = null
        _isBanned.value = false
        _nicknameErrorMessage.value = null
    }

    /**
     * owner/moderatorのみ実行可能(サーバー側で強制)。対象ユーザーをこのルームからBANする。
     * 成功後は対象がLiveKit側から即時キックされ、ParticipantDisconnectedイベントが
     * 発火して参加者リストからも自動的に消える。
     */
    suspend fun banParticipant(tokenServerUrl: String, idToken: String, roomId: String, targetUid: String) =
        withContext(Dispatchers.IO) {
            val encodedRoomId = java.net.URLEncoder.encode(roomId, "UTF-8")
            val encodedTargetUid = java.net.URLEncoder.encode(targetUid, "UTF-8")
            val request = Request.Builder()
                .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/members/$encodedTargetUid/ban")
                .addHeader("Authorization", "Bearer $idToken")
                .post("".toRequestBody(null))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.code != 200) {
                    val message = try {
                        response.body?.string()?.let {
                            JSONObject(it).optString("error").takeIf { s -> s.isNotEmpty() }
                        }
                    } catch (e: Exception) {
                        null
                    } ?: appContext.getString(R.string.errors_ban_action_failed, response.code)
                    _errorMessage.value = message
                    throw BanApiException(response.code, message)
                }
            }
        }

    /**
     * [Phase10: Guestロール 5.1]
     * 自分自身のニックネームを変更する(token-server/routes/rooms.js の
     * PATCH /:roomId/nickname)。roleを問わず本人のみ実行可能
     * (owner/moderator/member/guestいずれも対象)。反映自体はaddSnapshotListener
     * 経由で自動的に届くが、リクエスト成功時点でも楽観的にmyDisplayNameを更新しておく
     * (Web版stores/ban.tsのupdateNicknameと同じ設計)。
     */
    suspend fun updateNickname(tokenServerUrl: String, idToken: String, roomId: String, displayName: String) =
        withContext(Dispatchers.IO) {
            _nicknameErrorMessage.value = null
            _nicknameUpdating.value = true
            try {
                val encodedRoomId = java.net.URLEncoder.encode(roomId, "UTF-8")
                val body = JSONObject().apply { put("displayName", displayName) }
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/nickname")
                    .addHeader("Authorization", "Bearer $idToken")
                    .patch(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    val text = response.body?.string()
                    if (response.code != 200) {
                        val message = try {
                            text?.let { JSONObject(it).optString("error").takeIf { s -> s.isNotEmpty() } }
                        } catch (e: Exception) {
                            null
                        } ?: appContext.getString(R.string.errors_ban_action_failed, response.code)
                        _nicknameErrorMessage.value = message
                        throw BanApiException(response.code, message)
                    }
                    val json = JSONObject(text ?: "{}")
                    _myDisplayName.value = json.optString("displayName").takeIf { it.isNotEmpty() }
                }
            } finally {
                _nicknameUpdating.value = false
            }
        }
}
