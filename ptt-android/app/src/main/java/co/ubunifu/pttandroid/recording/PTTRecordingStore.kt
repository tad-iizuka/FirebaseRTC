/**
 * PTTRecordingStore.kt
 *
 * [録音開始/停止UI]
 * Web版(ptt-client/src/stores/recording.ts)・iOS版(PTTRecordingStore.swift)の移植。
 *
 * 実際に「録音中である」状態(active/startedAt)は Room Metadata 経由で
 * PTTConnectionManager が保持している(全参加者へのリアルタイム開示のため)。
 * このstoreは owner/moderator が叩く /recording/start・/recording/stop の
 * リクエスト自体と、そのローディング状態・エラー表示だけを担当する。
 *
 * [重要] /recording/start のレスポンスが返った時点ではまだ録音は開始されておらず、
 * /recording/stop も「停止を依頼した」だけ(token-server/routes/recording.js参照)。
 * 実際に録音中かどうかの確定状態は必ず PTTConnectionManager.isRecording を見ること。
 * このstoreの starting/stopping はあくまで「リクエストを送信中かどうか」の
 * ローディング表示用。
 */
package co.ubunifu.pttandroid.recording

import android.content.Context
import co.ubunifu.pttandroid.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class RecordingApiException(val statusCode: Int, message: String) : Exception(message)

class PTTRecordingStore(
    context: Context,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) {
    // [多言語化] エラーメッセージのローカライズ用。
    private val appContext = context.applicationContext

    private val _starting = MutableStateFlow(false)
    val starting: StateFlow<Boolean> = _starting

    private val _stopping = MutableStateFlow(false)
    val stopping: StateFlow<Boolean> = _stopping

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage

    /** owner/moderatorのみ実行可能(サーバー側で強制)。既に録音中の場合は409が返る。 */
    suspend fun startRecording(tokenServerUrl: String, idToken: String, roomId: String) =
        withContext(Dispatchers.IO) {
            _errorMessage.value = null
            _starting.value = true
            try {
                val encodedRoomId = java.net.URLEncoder.encode(roomId, "UTF-8")
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/recording/start")
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
                        } ?: appContext.getString(R.string.errors_recording_operation_failed, response.code)
                        _errorMessage.value = message
                        throw RecordingApiException(response.code, message)
                    }
                }
                // 開始の確定通知(recording.active: true)はRoom Metadata経由で
                // PTTConnectionManagerへ非同期に届く。ここでは楽観的に状態を変えない。
            } finally {
                _starting.value = false
            }
        }

    /** owner/moderatorのみ実行可能(サーバー側で強制)。録音中でなくても冪等に成功する。 */
    suspend fun stopRecording(tokenServerUrl: String, idToken: String, roomId: String) =
        withContext(Dispatchers.IO) {
            _errorMessage.value = null
            _stopping.value = true
            try {
                val encodedRoomId = java.net.URLEncoder.encode(roomId, "UTF-8")
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/recording/stop")
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
                        } ?: appContext.getString(R.string.errors_recording_operation_failed, response.code)
                        _errorMessage.value = message
                        throw RecordingApiException(response.code, message)
                    }
                }
                // これも「停止を依頼した」だけ。active:falseへの確定はegress_endedの
                // Webhook経由でRoom Metadataが更新されてからPTTConnectionManagerに反映される。
            } finally {
                _stopping.value = false
            }
        }
}
