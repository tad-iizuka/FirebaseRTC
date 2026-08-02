/**
 * PTTOrgContextStore.kt
 *
 * [パンくず表示・組織階層]
 * Web版(ptt-client/src/stores/orgContext.ts)の移植。GET /rooms/:roomId/org-context
 * を参照し、Room詳細画面にパンくずを表示する。
 *
 * [設計方針・Web版を踏襲] PTTBadgesStoreとは異なりポーリングしない。Roomの
 * 組織階層への割り当て(orgId/nodeId)はadmin-dashboard側での管理者操作でのみ
 * 変わり、変化頻度・即時反映の要求のいずれも低いため、入室時に1回取得すれば
 * 十分と判断した。
 */
package co.ubunifu.pttandroid.orgcontext

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

data class OrgBreadcrumbNode(
    val nodeId: String,
    val name: String,
    val depth: Int,
)

data class OrgContext(
    val orgId: String?,
    val orgName: String?,
    val breadcrumb: List<OrgBreadcrumbNode>,
) {
    companion object {
        val EMPTY = OrgContext(orgId = null, orgName = null, breadcrumb = emptyList())
    }
}

class PTTOrgContextStore(
    context: Context,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) {
    private val appContext = context.applicationContext

    private val _context = MutableStateFlow(OrgContext.EMPTY)
    val context_: StateFlow<OrgContext> = _context

    private var fetchJob: Job? = null

    /** ルーム入室時に1回だけ呼ぶ。 */
    fun fetchOnce(scope: CoroutineScope, tokenServerUrl: String, roomId: String, idTokenProvider: suspend () -> String) {
        fetchJob?.cancel()
        fetchJob = scope.launch {
            withContext(Dispatchers.IO) {
                try {
                    val idToken = idTokenProvider()
                    val encodedRoomId = URLEncoder.encode(roomId, "UTF-8")
                    val request = Request.Builder()
                        .url("${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/org-context")
                        .addHeader("Authorization", "Bearer $idToken")
                        .get()
                        .build()

                    httpClient.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) return@use
                        val body = response.body?.string() ?: return@use
                        val json = JSONObject(body)
                        val breadcrumbArray = json.optJSONArray("breadcrumb")
                        val breadcrumb = mutableListOf<OrgBreadcrumbNode>()
                        if (breadcrumbArray != null) {
                            for (i in 0 until breadcrumbArray.length()) {
                                breadcrumbArray.optJSONObject(i)?.let {
                                    breadcrumb.add(
                                        OrgBreadcrumbNode(
                                            nodeId = it.optString("nodeId"),
                                            name = it.optString("name"),
                                            depth = it.optInt("depth"),
                                        ),
                                    )
                                }
                            }
                        }
                        _context.value = OrgContext(
                            orgId = if (json.isNull("orgId")) null else json.optString("orgId"),
                            orgName = if (json.isNull("orgName")) null else json.optString("orgName"),
                            breadcrumb = breadcrumb,
                        )
                    }
                } catch (e: Exception) {
                    // 無所属Roomの方が多数派になりうる想定のため、取得失敗時も
                    // UI全体を止めず「表示しない」で済ませる(PTTBadgesStoreと同じ方針)。
                }
            }
        }
    }

    /** ルーム退出時に呼ぶ。 */
    fun stop() {
        fetchJob?.cancel()
        fetchJob = null
        _context.value = OrgContext.EMPTY
    }
}
