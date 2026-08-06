/**
 * PTTSavedRoomsStore.kt
 *
 * [よく使うルームの保存]
 * token-serverにはルーム一覧を返すAPIが無い(招待制のため「一覧」という概念が薄い)。
 * そのため、あくまで「自分が過去に作成/参加したルームにワンタップで戻れる」ための
 * ローカルな履歴としてSharedPreferencesに保存する。
 * 複数のFirebaseアカウントで同じ端末を使うケースを考慮し、
 * uidごとに別のSharedPreferencesキーに保存する(サインアウト/別アカウントでの汚染を防ぐ)。
 *
 * Web版(localStorage)・iOS版(UserDefaults)と同じデータモデル・方針。
 */
package co.ubunifu.pttandroid.room

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject

data class SavedRoom(
    val roomId: String,
    /** [表示仕様・2026-08-06] 未設定の場合はnull(以前は「招待コードで参加したルーム」という
     *  固定文言をフォールバックとして保存していたが廃止。一覧側でnullならroomIdを表示する)。 */
    val name: String?,
    /** 自分がowner(作成者)の場合のみ非null。再入室時に招待コードを再表示するために保持する。 */
    val inviteCode: String?,
    val lastUsedAtMillis: Long,
    /** [開始/終了時刻] 未設定の場合はnull。一覧の下段表示に使う。 */
    val schedule: RoomSchedule? = null,
)

class PTTSavedRoomsStore(context: Context) {

    private val appContext = context.applicationContext
    private val maxCount = 20

    private val _rooms = MutableStateFlow<List<SavedRoom>>(emptyList())
    val rooms: StateFlow<List<SavedRoom>> = _rooms

    private var storageKey: String? = null

    private fun prefs() = appContext.getSharedPreferences("ptt_saved_rooms", Context.MODE_PRIVATE)

    /** サインイン中のuidに応じてストレージキーを切り替え、そのユーザーの履歴を読み込む。
     *  サインアウト時は uid = null で呼び、一覧を空にする。 */
    fun load(uid: String?) {
        if (uid == null) {
            storageKey = null
            _rooms.value = emptyList()
            return
        }
        val key = "rooms:$uid"
        storageKey = key
        val raw = prefs().getString(key, null)
        _rooms.value = if (raw == null) emptyList() else parse(raw)
    }

    /** ルーム作成/参加のたびに呼ぶ。同じroomIdが既にあれば更新して先頭に移動する。 */
    fun upsert(roomId: String, name: String?, inviteCode: String?, schedule: RoomSchedule? = null) {
        if (storageKey == null) return
        val updated = mutableListOf(
            SavedRoom(roomId, name, inviteCode, System.currentTimeMillis(), schedule)
        )
        updated.addAll(_rooms.value.filter { it.roomId != roomId })
        _rooms.value = updated.take(maxCount)
        persist()
    }

    fun remove(roomId: String) {
        if (storageKey == null) return
        _rooms.value = _rooms.value.filter { it.roomId != roomId }
        persist()
    }

    private fun persist() {
        val key = storageKey ?: return
        val array = JSONArray()
        _rooms.value.forEach { room ->
            array.put(
                JSONObject().apply {
                    put("roomId", room.roomId)
                    put("name", room.name ?: JSONObject.NULL)
                    put("inviteCode", room.inviteCode ?: JSONObject.NULL)
                    put("lastUsedAt", room.lastUsedAtMillis)
                    val schedule = room.schedule
                    put(
                        "schedule",
                        if (schedule == null) {
                            JSONObject.NULL
                        } else {
                            JSONObject().apply {
                                put("start", schedule.start ?: JSONObject.NULL)
                                put("end", schedule.end ?: JSONObject.NULL)
                            }
                        }
                    )
                }
            )
        }
        prefs().edit().putString(key, array.toString()).apply()
    }

    private fun parse(raw: String): List<SavedRoom> = try {
        val array = JSONArray(raw)
        (0 until array.length()).map { i ->
            val obj = array.getJSONObject(i)
            // [後方互換] 旧フォーマットは "label"(常にString)のみを持っていた。
            // 新フォーマットの"name"が無ければ"label"にフォールバックする
            // (どちらも無い/読めない場合はnullのままroomIdの表示に任せる)。
            val name = if (obj.has("name") && !obj.isNull("name")) {
                obj.getString("name")
            } else {
                obj.optString("label", null)
            }
            val scheduleObj = obj.optJSONObject("schedule")
            val schedule = scheduleObj?.let {
                RoomSchedule(
                    start = if (it.has("start") && !it.isNull("start")) it.getLong("start") else null,
                    end = if (it.has("end") && !it.isNull("end")) it.getLong("end") else null,
                )
            }
            SavedRoom(
                roomId = obj.getString("roomId"),
                name = name,
                inviteCode = obj.optString("inviteCode", null).takeIf { it != "null" },
                lastUsedAtMillis = obj.optLong("lastUsedAt", 0L),
                schedule = schedule,
            )
        }
    } catch (e: Exception) {
        emptyList()
    }
}
