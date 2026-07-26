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
import co.ubunifu.pttandroid.model.AssignedBadge
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
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

private const val POLL_INTERVAL_MS = 20_000L

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

    private var pollJob: Job? = null

    /**
     * ポーリング開始。呼び出し側(PTTApp.ktのenterRoom)のCoroutineScopeに
     * 乗せる(connectionManager.connectのidTokenProviderと同じパターンで、
     * 呼び出しのたびに最新のIDトークンを取得する)。
     */
    fun start(scope: CoroutineScope, tokenServerUrl: String, roomId: String, idTokenProvider: suspend () -> String) {
        stop()
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
    }

    fun topBadgeFor(uid: String): AssignedBadge? = _byUid.value[uid]?.topBadge

    private suspend fun fetchOnce(tokenServerUrl: String, roomId: String, idTokenProvider: suspend () -> String) {
        withContext(Dispatchers.IO) {
            try {
                val idToken = idTokenProvider()
                val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
                val request = Request.Builder()
                    .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/badges")
                    .addHeader("Authorization", "Bearer $idToken")
                    .get()
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@use
                    val body = response.body?.string() ?: return@use
                    val membersJson = JSONObject(body).optJSONObject("members") ?: return@use
                    val parsed = mutableMapOf<String, RoomMemberBadges>()
                    membersJson.keys().forEach { uid ->
                        membersJson.optJSONObject(uid)?.let { parsed[uid] = parseRoomMemberBadges(it) }
                    }
                    _byUid.value = parsed
                }
            } catch (e: Exception) {
                // ポーリングの一時的な失敗(ネットワーク不調等)でUI全体を止めたくないため、
                // Web版stores/badges.tsと同じく無視して次回ポーリングに任せる。
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
}
