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
import co.ubunifu.pttandroid.appcheck.PTTAppCheckProvider

/**
 * [開始/終了時刻] Web版 types/api.ts の RoomSchedule・iOS版 PTTRoomManager.RoomSchedule と
 * 同じ形。start/endはそれぞれ未設定の場合nullでありうる(エポックミリ秒)。
 */
data class RoomSchedule(val start: Long?, val end: Long?)

/**
 * [開始/終了時刻] Web版 types/api.ts の ScheduleState・iOS版 PTTRoomManager.ScheduleState と
 * 同じ3値。token-server/lib/roomSchedule.js の resolveScheduleState() が返す文字列と一致させる。
 */
enum class ScheduleState(val wireValue: String) {
    BEFORE_START("before_start"),
    IN_SESSION("in_session"),
    AFTER_END("after_end");

    companion object {
        fun fromWireValue(value: String?): ScheduleState? = entries.firstOrNull { it.wireValue == value }
    }
}

/**
 * POST /rooms/:roomId/join のレスポンス。
 * [ルーム名] admin-dashboardで設定されたルーム名(name)。未設定の場合はnull
 * (token-server/routes/rooms.js・Web版JoinRoomResponse型と同じ形)。
 */
data class JoinedRoom(
    val roomId: String,
    val name: String?,
    val schedule: RoomSchedule?,
    val scheduleState: ScheduleState?
)

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

    /** "schedule": { "start": number|null, "end": number|null } を解釈する。
     *  schedule自体が欠落している場合はnullを返す(旧サーバー等との後方互換)。 */
    private fun parseSchedule(json: JSONObject): RoomSchedule? {
        if (!json.has("schedule") || json.isNull("schedule")) return null
        val scheduleJson = json.getJSONObject("schedule")
        val start = if (scheduleJson.has("start") && !scheduleJson.isNull("start")) scheduleJson.getLong("start") else null
        val end = if (scheduleJson.has("end") && !scheduleJson.isNull("end")) scheduleJson.getLong("end") else null
        return RoomSchedule(start, end)
    }

    /** "scheduleState": "before_start"|"in_session"|"after_end" を解釈する。
     *  欠落・不明な値の場合はnullを返す(呼び出し元でin_session相当として扱う)。 */
    private fun parseScheduleState(json: JSONObject): ScheduleState? {
        if (!json.has("scheduleState") || json.isNull("scheduleState")) return null
        return ScheduleState.fromWireValue(json.getString("scheduleState"))
    }

    /** 招待コードを検証してルームのmembersに参加する。戻り値にはルームID・ルーム名(name)・
     *  開始/終了時刻・現在の状態(before_start/in_session/after_end)を含む。 */
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
                    .apply { PTTAppCheckProvider.token()?.let { addHeader("X-Firebase-AppCheck", it) } }
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
                    JoinedRoom(
                        json.optString("roomId", roomId),
                        name,
                        parseSchedule(json),
                        parseScheduleState(json)
                    )
                }
            } finally {
                _isWorking.value = false
            }
        }

    /**
     * [ルーム名・開始/終了時刻の再取得]
     * 保存済みルームから再入室する場合(/joinを経由しない)、ルーム名・開始/終了時刻は
     * joinRoom()のレスポンスからは取得できない。iOS版(fetchRoomName)・
     * Web版(roomStore.fetchAutoRecording)と同じく、GET /recording/status
     * (token-server/routes/recording.js)に相乗りする形で取り直す。
     * 取得に失敗してもPTT自体の利用は妨げないため、例外は握りつぶしnullを返す
     * (呼び出し元でエラー表示等はしない)。
     */
    suspend fun fetchRoomName(tokenServerUrl: String, idToken: String, roomId: String): FetchedRoomStatus? =
        withContext(Dispatchers.IO) {
            try {
                val encodedRoomId = java.net.URLEncoder.encode(roomId, "UTF-8")
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/recording/status")
                    .addHeader("Authorization", "Bearer $idToken")
                    .apply { PTTAppCheckProvider.token()?.let { addHeader("X-Firebase-AppCheck", it) } }
                    .get()
                    .build()

                client.newCall(request).execute().use { response ->
                    val text = response.body?.string()
                    if (response.code != 200 || text == null) {
                        null
                    } else {
                        val json = JSONObject(text)
                        val name = if (json.has("name") && !json.isNull("name")) {
                            json.getString("name").takeIf { it.isNotEmpty() }
                        } else {
                            null
                        }
                        FetchedRoomStatus(name, parseSchedule(json), parseScheduleState(json))
                    }
                }
            } catch (e: Exception) {
                null
            }
        }
}

/** GET /rooms/:roomId/recording/status のうち、ここで使うのはname/schedule/scheduleStateのみ。 */
data class FetchedRoomStatus(val name: String?, val schedule: RoomSchedule?, val scheduleState: ScheduleState?)
