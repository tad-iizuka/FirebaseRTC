/**
 * PTTReportStore.kt
 *
 * [通報UI]
 * Web版(ptt-client/src/views/RoomView.vue の reportParticipant)・
 * iOS版(PTTReportStore.swift)の移植。token-server/routes/reports.js の
 * POST /reports を呼ぶだけの薄いストア。
 *
 * [重要] このAPIは通報データの受付のみを行う。実際の対応(内容確認・BAN実行)は、
 * モデレーターがFirestoreの reports コレクションを見て手動で行う運用のため、
 * クライアント側はここでの受付(201)を確認するところまでが責務であり、
 * 通報後に何らかの自動処理(自動BAN等)を行うことはない。
 */
package co.ubunifu.pttandroid.report

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

class ReportApiException(val statusCode: Int, message: String) : Exception(message)

class PTTReportStore(
    context: Context,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) {
    // [多言語化] エラーメッセージのローカライズ用。
    private val appContext = context.applicationContext
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private val _isSubmitting = MutableStateFlow(false)
    val isSubmitting: StateFlow<Boolean> = _isSubmitting

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage

    /**
     * @param reason 空文字はサーバー側でも400エラーになる。呼び出し側でtrim等により
     *   空でないことを確認してから呼ぶこと(Web版のreportParticipantが
     *   `window.prompt` の戻り値をtrimして空なら送信自体をskipしているのと同じ扱い)。
     */
    suspend fun submitReport(tokenServerUrl: String, idToken: String, roomId: String, reportedUid: String, reason: String) =
        withContext(Dispatchers.IO) {
            _errorMessage.value = null
            _isSubmitting.value = true
            try {
                val body = JSONObject().apply {
                    put("roomId", roomId)
                    put("reportedUid", reportedUid)
                    put("reason", reason)
                }
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/reports")
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
                        } ?: appContext.getString(R.string.errors_report_submission_failed, response.code)
                        _errorMessage.value = message
                        throw ReportApiException(response.code, message)
                    }
                }
            } finally {
                _isSubmitting.value = false
            }
        }
}
