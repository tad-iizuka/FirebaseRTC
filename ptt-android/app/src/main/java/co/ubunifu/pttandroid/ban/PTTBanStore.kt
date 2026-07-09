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

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class BanApiException(val statusCode: Int, message: String) : Exception(message)

class PTTBanStore(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) {
    private val db = FirebaseFirestore.getInstance()

    /** 現在入室中のルームでの自分のロール。"owner" | "moderator" | "member" | null(未取得/不明) */
    private val _myRole = MutableStateFlow<String?>(null)
    val myRole: StateFlow<String?> = _myRole

    /** 自分がこのルームからBANされたことを検知した場合にtrueになる */
    private val _isBanned = MutableStateFlow(false)
    val isBanned: StateFlow<Boolean> = _isBanned

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage

    private var listener: ListenerRegistration? = null

    /** ルーム入室時に呼ぶ。自分のロールを取得し、BAN状態のリアルタイム監視を開始する。 */
    fun start(roomId: String, uid: String) {
        stop()
        if (uid.isEmpty()) return

        val ref = db.collection("rooms").document(roomId).collection("members").document(uid)

        ref.get()
            .addOnSuccessListener { snap ->
                _myRole.value = if (snap.exists()) (snap.getString("role") ?: "member") else null
            }
            .addOnFailureListener { e ->
                _errorMessage.value = "ロール取得エラー: ${e.message}"
                _myRole.value = null
            }

        listener = ref.addSnapshotListener { snapshot, error ->
            if (error != null) {
                _errorMessage.value = "BAN監視エラー: ${error.message}"
                return@addSnapshotListener
            }
            if (snapshot != null && snapshot.exists() && snapshot.getString("status") == "banned") {
                _isBanned.value = true
            }
        }
    }

    /** ルーム退出時に呼ぶ。 */
    fun stop() {
        listener?.remove()
        listener = null
        _myRole.value = null
        _isBanned.value = false
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
                    } ?: "BAN処理に失敗しました (HTTP ${response.code})"
                    _errorMessage.value = message
                    throw BanApiException(response.code, message)
                }
            }
        }
}
