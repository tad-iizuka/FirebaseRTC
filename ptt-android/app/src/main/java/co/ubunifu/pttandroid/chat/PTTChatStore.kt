/**
 * PTTChatStore.kt
 *
 * [Phase5: テキストチャット]
 * Web版/iOS版と同じ設計: 書き込みはtoken-server経由のみ、配信・履歴表示は
 * Firestoreのリアルタイムリスナー(addSnapshotListener)に任せる。LiveKitの
 * Data Channelは使わない(サーバーを経由しないためモデレーション・履歴配信・
 * BAN時の読み取り遮断ができないため)。BANされるとfirestore.rules側で
 * 読み取り権限自体を失う(PTTRoomManagerのBAN即時反映と同じ二重の強制力)。
 *
 * また、自分がこのルームの「アクティブな」メンバーであることを
 * firestore.rulesが要求するため(rooms/{roomId}/members/{uid}.status=='active')、
 * BAN済みユーザーの購読は自動的にエラーになる。
 */
package co.ubunifu.pttandroid.chat

import co.ubunifu.pttandroid.model.ChatMessage
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
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

class PTTChatStore(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val db = FirebaseFirestore.getInstance()

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage

    private var listener: ListenerRegistration? = null

    /** ルーム入室時に呼ぶ。直近200件の履歴をリアルタイムに購読する。 */
    fun start(roomId: String) {
        stop()
        listener = db.collection("rooms").document(roomId).collection("messages")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(200)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    _errorMessage.value = "チャット履歴の取得に失敗しました: ${error.message}"
                    return@addSnapshotListener
                }
                val docs = snapshot?.documents.orEmpty().map { doc ->
                    ChatMessage(
                        id = doc.id,
                        uid = doc.getString("uid") ?: "",
                        displayName = doc.getString("displayName") ?: "",
                        text = doc.getString("text") ?: "",
                        createdAtMillis = doc.getDate("createdAt")?.time,
                    )
                }
                _messages.value = docs.reversed() // 古い→新しい順に並べ直す
            }
    }

    /** ルーム退出時に呼ぶ。 */
    fun stop() {
        listener?.remove()
        listener = null
        _messages.value = emptyList()
    }

    /** テキストを送信する。永続化・配信はtoken-server経由で行われるため、
     *  このメソッド自身はFirestoreへ書き込まない。 */
    suspend fun sendMessage(tokenServerUrl: String, idToken: String, roomId: String, text: String) =
        withContext(Dispatchers.IO) {
            val trimmed = text.trim()
            if (trimmed.isEmpty()) return@withContext

            val encodedRoomId = java.net.URLEncoder.encode(roomId, "UTF-8")
            val body = JSONObject().apply { put("text", trimmed) }
            val request = Request.Builder()
                .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/messages")
                .addHeader("Authorization", "Bearer $idToken")
                .post(body.toString().toRequestBody(jsonMediaType))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.code != 201) {
                    val message = try {
                        response.body?.string()?.let {
                            JSONObject(it).optString("error").takeIf { s -> s.isNotEmpty() }
                        }
                    } catch (e: Exception) {
                        null
                    } ?: "メッセージの送信に失敗しました (HTTP ${response.code})"
                    _errorMessage.value = message
                    throw IllegalStateException(message)
                }
            }
        }
}
