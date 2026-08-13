/**
 * PTTBadgesStore.kt
 *
 * [Phase13・次アクションitem3]
 * Web版(ptt-client/src/stores/badges.ts)の移植。参加者一覧でのバッジ表示
 * (最優先1件のみ)のため、GET /rooms/:roomId/badges を一定間隔でポーリングする。
 *
 * [設計方針・Web版を踏襲]
 * 送話ロック・録音状態のようにLiveKit Room Metadata経由のリアルタイム反映は
 * 行わない(バッジの変化頻度は低く、Owner操作の即時性が強く求められる性質の
 * ものでもないため)。PTTBanStoreのmyRole取得のようにFirestoreへ直接
 * addSnapshotListenerすることもしない(badges/badgeGrantsはfirestore.rulesで
 * クライアントへの直接読み取りを禁止しているため、そもそも購読できない)。
 * admin-dashboardのusePollingと同じ考え方のシンプルなポーリング実装に
 * とどめる(Phase13はPoCスコープ)。
 *
 * [エラー処理] ポーリングの一時的な失敗でUI全体を止めたくないため、
 * report/recording等の操作系storeとは異なりエラーメッセージのUI表示自体を
 * 持たない(Web版stores/badges.tsのerrorMessageと同じく、保持するだけで
 * 画面には出さない設計。値を捨てて次回ポーリングに任せる)。
 */
package co.ubunifu.pttandroid.badges

import android.content.Context
import co.ubunifu.pttandroid.R
import co.ubunifu.pttandroid.model.AssignedBadge
import co.ubunifu.pttandroid.model.GrantableBadge
import co.ubunifu.pttandroid.model.RoomMemberBadges
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import co.ubunifu.pttandroid.appcheck.PTTAppCheckProvider

private const val POLL_INTERVAL_MS = 20_000L

class BadgeApiException(val statusCode: Int, message: String) : Exception(message)

class PTTBadgesStore(
    context: Context,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) {
    // 現状はエラーメッセージのローカライズに使っていないが、他store(report/recording)と
    // 構成を揃えるため保持しておく。
    private val appContext = context.applicationContext

    /** uid -> そのメンバーの現在のバッジ情報(topBadgeのみ参照する想定だが、
     * 将来のプロフィール画面用にbadges全件も保持しておく)。Web版のbyUidと同じ。 */
    private val _byUid = MutableStateFlow<Map<String, RoomMemberBadges>>(emptyMap())
    val byUid: StateFlow<Map<String, RoomMemberBadges>> = _byUid

    /**
     * [2026-08-04・次アクションitem4] Room内owner向け付与UI。ownerでなければ常にnull
     * (サーバー側がowner以外にはnullを返すため、クライアント側でrole判定を二重に
     * 行う必要はない。UI側は「nullなら出さない」だけでよい。Web版stores/badges.tsの
     * grantableBadgesと同じ設計)。
     */
    private val _grantableBadges = MutableStateFlow<List<GrantableBadge>?>(null)
    val grantableBadges: StateFlow<List<GrantableBadge>?> = _grantableBadges

    private val _isGranting = MutableStateFlow(false)
    val isGranting: StateFlow<Boolean> = _isGranting

    private val _grantErrorMessage = MutableStateFlow<String?>(null)
    val grantErrorMessage: StateFlow<String?> = _grantErrorMessage

    // [2026-08-04] 付与/剥奪成功直後にポーリング間隔を待たず再取得するために保持する。
    private var currentTokenServerUrl: String? = null
    private var currentRoomId: String? = null
    private var currentIdTokenProvider: (suspend () -> String)? = null

    private var pollJob: Job? = null

    /**
     * ポーリング開始。呼び出し側(PTTApp.ktのenterRoom)のCoroutineScopeに
     * 乗せる(connectionManager.connectのidTokenProviderと同じパターンで、
     * 呼び出しのたびに最新のIDトークンを取得する)。
     */
    fun start(scope: CoroutineScope, tokenServerUrl: String, roomId: String, idTokenProvider: suspend () -> String) {
        stop()
        currentTokenServerUrl = tokenServerUrl
        currentRoomId = roomId
        currentIdTokenProvider = idTokenProvider
        pollJob = scope.launch {
            while (isActive) {
                fetchOnce(tokenServerUrl, roomId, idTokenProvider)
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    fun stop() {
        pollJob?.cancel()
        pollJob = null
        _byUid.value = emptyMap()
        _grantableBadges.value = null
        _grantErrorMessage.value = null
        currentTokenServerUrl = null
        currentRoomId = null
        currentIdTokenProvider = null
    }

    fun topBadgeFor(uid: String): AssignedBadge? = _byUid.value[uid]?.topBadge

    /** [2026-08-04・次アクションitem4] 現在付与されている全バッジ(剥奪ボタンの表示用)。
     * Guestの役割バッジ(source == "guest-role")は剥奪操作の対象外のため、
     * 呼び出し側でsource == "grant"のみ表示に使うこと(Web版ParticipantList.vueと同じ絞り込み)。 */
    fun allBadgesFor(uid: String): List<AssignedBadge> = _byUid.value[uid]?.badges ?: emptyList()

    private suspend fun fetchOnce(tokenServerUrl: String, roomId: String, idTokenProvider: suspend () -> String) {
        withContext(Dispatchers.IO) {
            try {
                val idToken = idTokenProvider()
                val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/badges")
                    .addHeader("Authorization", "Bearer $idToken")
                    .apply { PTTAppCheckProvider.token()?.let { addHeader("X-Firebase-AppCheck", it) } }
                    .get()
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@use
                    val body = response.body?.string() ?: return@use
                    applyResponseBody(body)
                }
            } catch (e: Exception) {
                // ポーリングの一時的な失敗(ネットワーク不調等)でUI全体を止めたくないため、
                // Web版stores/badges.tsと同じく無視して次回ポーリングに任せる。
            }
        }
    }

    private fun applyResponseBody(body: String) {
        val json = JSONObject(body)
        val membersJson = json.optJSONObject("members") ?: JSONObject()
        val parsed = mutableMapOf<String, RoomMemberBadges>()
        membersJson.keys().forEach { uid ->
            membersJson.optJSONObject(uid)?.let { parsed[uid] = parseRoomMemberBadges(it) }
        }
        _byUid.value = parsed

        // [2026-08-04・次アクションitem4] ownerでない場合はサーバー側からnull(未設定=キー
        // 自体が存在しないかJSONNullとして返る)。isNull判定でnullとnullでない配列を区別する。
        _grantableBadges.value = if (json.isNull("grantableBadges") || !json.has("grantableBadges")) {
            null
        } else {
            val array = json.optJSONArray("grantableBadges")
            (0 until (array?.length() ?: 0)).mapNotNull { i ->
                array?.optJSONObject(i)?.let {
                    GrantableBadge(
                        badgeId = it.optString("badgeId"),
                        name = it.optString("name"),
                        icon = it.optString("icon"),
                        category = it.optString("category"),
                    )
                }
            }
        }
    }

    private fun parseRoomMemberBadges(entry: JSONObject): RoomMemberBadges {
        val badgesArray = entry.optJSONArray("badges")
        val badges = mutableListOf<AssignedBadge>()
        if (badgesArray != null) {
            for (i in 0 until badgesArray.length()) {
                badgesArray.optJSONObject(i)?.let { badges.add(parseAssignedBadge(it)) }
            }
        }
        val topBadge = entry.optJSONObject("topBadge")?.let { parseAssignedBadge(it) }
        return RoomMemberBadges(badges = badges, topBadge = topBadge)
    }

    private fun parseAssignedBadge(json: JSONObject) = AssignedBadge(
        badgeId = json.optString("badgeId"),
        name = json.optString("name"),
        icon = json.optString("icon"),
        category = json.optString("category"),
        priority = json.optInt("priority"),
        source = json.optString("source"),
    )

    /**
     * [2026-08-04・次アクションitem4] Room内owner専用の手動付与。
     * POST /:roomId/members/:targetUid/badges(routes/roomBadges.js)を叩く。
     * サーバー側はさらに対象バッジのgrantableByRoomOwnerフラグを検証するため、
     * クライアント側は「選択肢(grantableBadges)に出ているものだけを叩く」以上の
     * 権限チェックを重複実装しない(PTTBanStoreと同じくサーバーを信頼する設計)。
     */
    suspend fun grantBadge(tokenServerUrl: String, idToken: String, roomId: String, targetUid: String, badgeId: String) =
        mutateBadge(tokenServerUrl, roomId, targetUid) {
            val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
            val encodedTargetUid = URLEncoder.encode(targetUid, "UTF-8")
            val body = JSONObject().apply { put("badgeId", badgeId) }
            Request.Builder()
                .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/members/$encodedTargetUid/badges")
                .addHeader("Authorization", "Bearer $idToken")
                .apply { PTTAppCheckProvider.token()?.let { addHeader("X-Firebase-AppCheck", it) } }
                .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()
        }

    /** Room内owner専用の手動剥奪(DELETE /:roomId/members/:targetUid/badges/:badgeId)。 */
    suspend fun revokeBadge(tokenServerUrl: String, idToken: String, roomId: String, targetUid: String, badgeId: String) =
        mutateBadge(tokenServerUrl, roomId, targetUid) {
            val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
            val encodedTargetUid = URLEncoder.encode(targetUid, "UTF-8")
            val encodedBadgeId = URLEncoder.encode(badgeId, "UTF-8")
            Request.Builder()
                .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/members/$encodedTargetUid/badges/$encodedBadgeId")
                .addHeader("Authorization", "Bearer $idToken")
                .apply { PTTAppCheckProvider.token()?.let { addHeader("X-Firebase-AppCheck", it) } }
                .delete()
                .build()
        }

    private suspend fun mutateBadge(tokenServerUrl: String, roomId: String, targetUid: String, buildRequest: suspend () -> Request) =
        withContext(Dispatchers.IO) {
            _isGranting.value = true
            _grantErrorMessage.value = null
            try {
                httpClient.newCall(buildRequest()).execute().use { response ->
                    if (!response.isSuccessful) {
                        val message = try {
                            response.body?.string()?.let {
                                JSONObject(it).optString("error").takeIf { s -> s.isNotEmpty() }
                            }
                        } catch (e: Exception) {
                            null
                        } ?: appContext.getString(R.string.errors_badge_action_failed, response.code)
                        _grantErrorMessage.value = message
                        throw BadgeApiException(response.code, message)
                    }
                }

                // Web版・iOS版と同じく、成功後はポーリング間隔を待たず即座に再取得して
                // UIへ反映する。再取得自体の失敗はここでは無視する(次回ポーリングに任せる)。
                val idTokenProvider = currentIdTokenProvider
                val serverUrl = currentTokenServerUrl
                val currentRoom = currentRoomId
                if (idTokenProvider != null && serverUrl != null && currentRoom == roomId) {
                    try {
                        val freshIdToken = idTokenProvider()
                        val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
                        val refetchRequest = Request.Builder()
                            .url("${serverUrl.trimEnd('/')}/rooms/$encodedRoomId/badges")
                            .addHeader("Authorization", "Bearer $freshIdToken")
                            .apply { PTTAppCheckProvider.token()?.let { addHeader("X-Firebase-AppCheck", it) } }
                            .get()
                            .build()
                        httpClient.newCall(refetchRequest).execute().use { response ->
                            if (response.isSuccessful) {
                                response.body?.string()?.let { applyResponseBody(it) }
                            }
                        }
                    } catch (e: Exception) {
                        // 再取得失敗は無視(次回ポーリングに任せる)。
                    }
                }
            } finally {
                _isGranting.value = false
            }
        }
}
