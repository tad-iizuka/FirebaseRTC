/**
 * PTTRoomManager.kt
 *
 * [招待制ルーム対応]
 * token-server は「ルームIDを知っていれば誰でも入れる」設計ではなく、
 * invite_only(招待制)になっている。/token を取得する前に、必ず
 *   - POST /rooms/:roomId/join  (招待コードを検証してmembersに追加)
 * でルームのメンバーになっている必要がある(token-server/routes/rooms.js)。
 * Web版/iOS版のjoinRoomに相当する処理。
 *
 * [ルーム作成のadmin-dashboard移管]
 * 以前はここに createRoom() (POST /rooms) があったが、ルーム作成は
 * admin-dashboard専用の POST /admin/rooms(rooms:create権限)へ移管した。
 * ptt-android側からはルームを作成できない(Web版ptt-client/src/stores/room.ts・
 * brushup-plan.md参照)。
 */
package co.ubunifu.pttandroid.room

import android.content.Context
import co.ubunifu.pttandroid.R
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

/**
 * POST /rooms/:roomId/join のレスポンス。
 * [ルーム名] admin-dashboardで設定されたルーム名(name)。未設定の場合はnull
 * (token-server/routes/rooms.js・Web版JoinRoomResponse型と同じ形)。
 */
data class JoinedRoom(val roomId: String, val name: String?)

class RoomApiException(val statusCode: Int, message: String) : Exception(message)

class PTTRoomManager(
    context: Context,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()
) {
    // [多言語化] エラーメッセージのローカライズにres/values(-en)/strings.xmlを使うため、
    // applicationContextを保持しておく(このクラス自体はActivity/Composeに依存しない)。
    private val appContext = context.applicationContext
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

    /** 招待コードを検証してルームのmembersに参加する。戻り値にはルームID・ルーム名(name)を含む。 */
    suspend fun joinRoom(tokenServerUrl: String, idToken: String, roomId: String, inviteCode: String): JoinedRoom =
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
                    val text = response.body?.string()
                    if (response.code != 200) {
                        val message = parseServerError(text)
                            ?: appContext.getString(R.string.errors_room_request_failed, response.code)
                        _lastErrorMessage.value = message
                        throw RoomApiException(response.code, message)
                    }
                    val json = JSONObject(text ?: "{}")
                    // [ルーム名] 未設定の場合はnull(JSONのnullとフィールド自体の欠落の両方をnullとして扱う)。
                    val name = if (json.has("name") && !json.isNull("name")) {
                        json.getString("name").takeIf { it.isNotEmpty() }
                    } else {
                        null
                    }
                    JoinedRoom(json.optString("roomId", roomId), name)
                }
            } finally {
                _isWorking.value = false
            }
        }
}
