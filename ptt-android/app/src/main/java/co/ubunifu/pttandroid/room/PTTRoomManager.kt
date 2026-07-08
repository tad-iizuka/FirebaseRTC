/**
 * PTTRoomManager.kt
 *
 * [招待制ルーム対応]
 * token-server は「ルームIDを知っていれば誰でも入れる」設計ではなく、
 * invite_only(招待制)になっている。/token を取得する前に、必ず
 *   - POST /rooms            (ルーム作成。呼び出しユーザーがownerになる)
 *   - POST /rooms/:roomId/join  (招待コードを検証してmembersに追加)
 * のいずれかでルームのメンバーになっている必要がある(token-server/routes/rooms.js)。
 * Web版/iOS版のcreateRoom/joinRoomに相当する処理。
 */
package co.ubunifu.pttandroid.room

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

data class CreatedRoom(val roomId: String, val inviteCode: String)

class RoomApiException(val statusCode: Int, message: String) : Exception(message)

class PTTRoomManager(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()
) {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private val _isWorking = MutableStateFlow(false)
    val isWorking: StateFlow<Boolean> = _isWorking

    private val _lastErrorMessage = MutableStateFlow<String?>(null)
    val lastErrorMessage: StateFlow<String?> = _lastErrorMessage

    fun clearError() {
        _lastErrorMessage.value = null
    }

    private fun parseServerError(body: String?): String? = try {
        body?.let { JSONObject(it).optString("error").takeIf { s -> s.isNotEmpty() } }
    } catch (e: Exception) {
        null
    }

    /** 新しいルームを作成する。戻り値はownerとして払い出される招待コードとルームID。 */
    suspend fun createRoom(tokenServerUrl: String, idToken: String, maxMembers: Int? = null): CreatedRoom =
        withContext(Dispatchers.IO) {
            _isWorking.value = true
            _lastErrorMessage.value = null
            try {
                val body = JSONObject().apply {
                    if (maxMembers != null) put("maxMembers", maxMembers)
                }
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/rooms")
                    .addHeader("Authorization", "Bearer $idToken")
                    .post(body.toString().toRequestBody(jsonMediaType))
                    .build()

                client.newCall(request).execute().use { response ->
                    val text = response.body?.string()
                    if (response.code != 201) {
                        val message = parseServerError(text) ?: "リクエストに失敗しました (HTTP ${response.code})"
                        _lastErrorMessage.value = message
                        throw RoomApiException(response.code, message)
                    }
                    val json = JSONObject(text ?: "{}")
                    CreatedRoom(json.getString("roomId"), json.getString("inviteCode"))
                }
            } finally {
                _isWorking.value = false
            }
        }

    /** 招待コードを検証してルームのmembersに参加する。 */
    suspend fun joinRoom(tokenServerUrl: String, idToken: String, roomId: String, inviteCode: String) =
        withContext(Dispatchers.IO) {
            _isWorking.value = true
            _lastErrorMessage.value = null
            try {
                val encodedRoomId = java.net.URLEncoder.encode(roomId, "UTF-8")
                val body = JSONObject().apply { put("inviteCode", inviteCode) }
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/join")
                    .addHeader("Authorization", "Bearer $idToken")
                    .post(body.toString().toRequestBody(jsonMediaType))
                    .build()

                client.newCall(request).execute().use { response ->
                    if (response.code != 200) {
                        val message = parseServerError(response.body?.string())
                            ?: "リクエストに失敗しました (HTTP ${response.code})"
                        _lastErrorMessage.value = message
                        throw RoomApiException(response.code, message)
                    }
                }
            } finally {
                _isWorking.value = false
            }
        }
}
