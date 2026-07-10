/**
 * PTTConnectionManager.kt
 *
 * [LiveKit移行]
 * iOS版(PTTConnectionManager.swift)と同じく、マイク取得・Opusエンコード/デコード・
 * 送受信は全てLiveKit Android SDKの `Room` オブジェクトが代行するため、
 * このクラスは「トークン取得 → Room接続 → PTTのオン/オフ」の橋渡し役に留まる。
 *
 * 送話中インジケーターは、ptt_start/ptt_end のような自前JSONメッセージではなく、
 * LiveKitの `RoomEvent`(TrackMuted/TrackUnmuted)をそのまま使う。
 *
 * [送話ロック連携]
 * Web版(ptt-client/public/index.html)・iOS版(PTTConnectionManager.swift)と同じく、
 * token-server の POST /rooms/:roomId/talk/start | /talk/heartbeat | /talk/stop
 * (token-server/routes/talk.js) を呼び出し、サーバー側のFirestoreトランザクションで
 * 排他制御を強制する。クライアント側のUI抑制だけに頼らない。
 *   - PTTボタン押下時: talk/start を呼び、成功して初めてマイクを有効化する。
 *     他人が保持中なら409(talk_locked)が返るので、その場合は送話を開始しない。
 *   - 送話中: LOCK_TTL_MS(サーバー側15秒)より十分短い間隔でtalk/heartbeatを呼び、
 *     ロックの失効を防ぐ。heartbeatが失敗した場合(サーバー側でMAX_HOLD_MS超過等により
 *     既にロックを失っている)は、強制的に送話を終了する。
 *   - PTTボタン解放時 / 切断時: talk/stop を呼びロックを明示的に解放する
 *     (ベストエフォート。失敗してもサーバー側のTTL失効に任せられる)。
 *   - サーバーが LiveKit Room Metadata に書き込む { currentTalker, ... } を
 *     RoomEvent.RoomMetadataChanged 経由で受け取り、他人が発話中の間はUI側
 *     (PTTApp.kt)でPTTボタンを無効化できるよう currentTalkerUid として公開する。
 *
 * [注意] LiveKit Android SDKはバージョンによってAPIの细部(イベントの型・
 * メソッド名)が変わることがある。ここでは 2.x 系の`Room.events`
 * (Flow<RoomEvent>を購読するスタイル)を前提にしている。導入時は
 * 実際に依存させたバージョンのドキュメント/サンプルアプリと突き合わせること。
 * RoomEvent.RoomMetadataChanged の具体的なフィールド名は仮定せず、イベント発火時に
 * 保持中の `room.metadata` を読み直す実装にしているため、フィールド名の相違による
 * 実行時の不整合は起きにくい設計にしてある。
 * https://github.com/livekit/client-sdk-android
 */
package co.ubunifu.pttandroid.connection

import android.content.Context
import co.ubunifu.pttandroid.model.ConnectionStatus
import co.ubunifu.pttandroid.model.ParticipantInfo
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

class TokenFetchException(val statusCode: Int, message: String) : Exception(message)

class PTTConnectionManager(
    private val appContext: Context,
    private val scope: CoroutineScope,
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) {
    private val _status = MutableStateFlow<ConnectionStatus>(ConnectionStatus.Disconnected)
    val status: StateFlow<ConnectionStatus> = _status

    // [BAN対応] 以前は「現在送話中(unmute)のidentity集合」のみを保持していたが、
    // BANボタンの表示にはルーム内の全参加者(名前つき)が必要なため、
    // identity -> 表示用情報 の辞書に置き換えた。ローカル参加者(自分)は含めない。
    private val _participants = MutableStateFlow<Map<String, ParticipantInfo>>(emptyMap())
    val participants: StateFlow<Map<String, ParticipantInfo>> = _participants

    private val _logLines = MutableStateFlow<List<String>>(emptyList())
    val logLines: StateFlow<List<String>> = _logLines

    private val _isSending = MutableStateFlow(false)
    val isSending: StateFlow<Boolean> = _isSending

    // [送話ロック連携] サーバー(routes/talk.js)がLiveKitのRoom Metadataに書き込む
    // currentTalker(uid)。nullなら誰も発話ロックを保持していない。
    // UI側(PTTApp.kt)は自分以外のuidが入っている間、PTTボタンを無効化する。
    private val _currentTalkerUid = MutableStateFlow<String?>(null)
    val currentTalkerUid: StateFlow<String?> = _currentTalkerUid

    private var room: Room? = null
    private var tokenServerUrl: String = ""
    private var livekitUrl: String = ""
    private var roomName: String = ""
    private var idTokenProvider: (suspend () -> String)? = null
    private var eventJob: Job? = null

    // 送話ロック関連の状態。Web版/iOS版のpttHeld・talkRequestTokenと同じ役割。
    private var pttHeld = false
    private var talkRequestToken = 0
    private var heartbeatJob: Job? = null

    private enum class TalkAction(val path: String) {
        START("start"),
        HEARTBEAT("heartbeat"),
        STOP("stop"),
    }

    companion object {
        // サーバー側 LOCK_TTL_MS(15秒, token-server/routes/talk.js) より
        // 十分短い間隔で延長する。Web版のTALK_LOCK_HEARTBEAT_MSと同じ値。
        private const val TALK_LOCK_HEARTBEAT_MS = 5000L
    }

    /**
     * @param idTokenProvider token-server呼び出し時に都度呼ばれ、有効なFirebase ID Tokenを
     *   返すsuspend関数。呼び出し側(PTTAuthManager)が期限切れ検知・自動リフレッシュを担う。
     */
    fun connect(
        tokenServerUrl: String,
        livekitUrl: String,
        roomNameParam: String,
        idTokenProvider: suspend () -> String,
    ) {
        if (room != null) {
            appendLog("すでに接続中/接続試行中です")
            return
        }

        this.tokenServerUrl = tokenServerUrl
        this.livekitUrl = livekitUrl
        this.roomName = roomNameParam
        this.idTokenProvider = idTokenProvider
        _status.value = ConnectionStatus.Connecting
        _currentTalkerUid.value = null

        scope.launch {
            try {
                val token = fetchToken()
                appendLog("トークン取得成功")

                val newRoom = LiveKit.create(appContext)
                room = newRoom
                observeEvents(newRoom)

                newRoom.connect(url = livekitUrl, token = token)

                // PTTのため、接続直後はマイクを無効化しておく
                // (トラックは作られるが送信されない = ボタンを押すまで無音)
                newRoom.localParticipant.setMicrophoneEnabled(false)

                // 接続時点で既に誰かが発話ロックを保持していた場合に備え、room.metadataから
                // 初期状態を読み込む(RoomMetadataChangedは「変化した瞬間」のイベントなので、
                // 接続前からの既存状態は別途拾う必要がある。Web版/iOS版と同じ理由)。
                _currentTalkerUid.value = parseCurrentTalker(newRoom.metadata)

                // 接続時点ですでに他の参加者がいる場合、参加後に発火するイベントだけでは
                // 拾えないため remoteParticipants から初期状態を取り込む。
                // TrackPublication.muted (LiveKit Android SDK) はサーバーから受け取った
                // TrackInfo.muted で初期化されるため、トラック未購読の時点でも信頼できる。
                // 音声トラック自体が存在しない(まだ一度もマイクをpublishしていない)
                // 参加者のみ、安全側に倒して「未送話」扱いにしておく。
                _participants.value = newRoom.remoteParticipants.values.associate { p ->
                    val id = p.identity?.value ?: "?"
                    val muted = p.trackPublications.values.firstOrNull { it.kind == Track.Kind.AUDIO }?.muted ?: true
                    id to ParticipantInfo(identity = id, name = p.name ?: id, muted = muted)
                }

                _status.value = ConnectionStatus.Connected(roomNameParam)
                appendLog("ルーム接続完了: room=$roomNameParam")
            } catch (e: Exception) {
                appendLog("接続エラー: ${e.message}")
                _status.value = ConnectionStatus.Error(e.message ?: "不明なエラー")
                room = null
            }
        }
    }

    fun disconnect() {
        val current = room ?: return
        pttHeld = false
        talkRequestToken++
        stopTalkHeartbeat()
        scope.launch {
            eventJob?.cancel()
            // 自分がロックを保持したまま切断すると、サーバー側はTTL(15秒)経過まで
            // 他の人をブロックし続けてしまうため、ベストエフォートで明示的に解放しておく。
            // (失敗しても実害はTTL経過まで待つだけなので、エラーは握りつぶしてよい)
            try {
                talkRequest(TalkAction.STOP)
            } catch (e: Exception) {
                // ベストエフォート
            }
            current.disconnect()
            room = null
            _participants.value = emptyMap()
            _isSending.value = false
            _currentTalkerUid.value = null
            _status.value = ConnectionStatus.Disconnected
            appendLog("切断しました")
        }
    }

    /** PTTボタンが押された */
    fun startTalking() {
        val current = room ?: return
        if (_status.value !is ConnectionStatus.Connected || _isSending.value) return
        // 他人が発話ロックを保持中の場合、UI側(PTTApp.kt)がタップ判定を無効化する
        // 想定だが、念のためここでも二重に弾く。
        if (_currentTalkerUid.value != null) return

        pttHeld = true
        val myToken = ++talkRequestToken

        scope.launch {
            try {
                talkRequest(TalkAction.START)
            } catch (e: Exception) {
                // 他人が発話中(409 talk_locked)など。RoomMetadataChangedでほぼ同時に
                // ボタンも無効化されるはずだが、競合(ほぼ同時押下)によるレースは起こりうる。
                appendLog("発話を開始できませんでした: ${e.message}")
                if (myToken == talkRequestToken) pttHeld = false
                return@launch
            }

            // [レース対策] talk/start の応答待ち(Cloud Runのコールドスタート等で1秒近く
            // かかることがある)の間にボタンが離されていた場合、ここで送話を開始してしまうと
            // 「離したのに喋り続ける」状態になる。ロックは既に取得できてしまっているので、
            // 使わないままサーバー側に解放を伝える。
            if (!pttHeld || myToken != talkRequestToken) {
                launch {
                    try {
                        talkRequest(TalkAction.STOP)
                    } catch (e: Exception) {
                        // ベストエフォート
                    }
                }
                return@launch
            }

            try {
                current.localParticipant.setMicrophoneEnabled(true)
                _isSending.value = true
                startTalkHeartbeat()
            } catch (e: Exception) {
                appendLog("マイク有効化エラー: ${e.message}")
                launch {
                    try {
                        talkRequest(TalkAction.STOP)
                    } catch (e: Exception) {
                        // ベストエフォート
                    }
                }
            }
        }
    }

    /**
     * PTTボタンが離された。
     * @param forced heartbeat失敗などサーバー側で既にロックを失っている場合にtrue。
     *   この場合 talk/stop の呼び出し自体は冪等なので害はないが、二重に呼ぶ必要はない。
     */
    fun stopTalking(forced: Boolean = false) {
        pttHeld = false
        talkRequestToken++ // 進行中のstartTalkingがあれば、その結果を無視させる
        val current = room ?: return
        stopTalkHeartbeat()
        _isSending.value = false
        scope.launch {
            try {
                current.localParticipant.setMicrophoneEnabled(false)
            } catch (e: Exception) {
                appendLog("マイク無効化エラー: ${e.message}")
            }
            if (!forced) {
                try {
                    talkRequest(TalkAction.STOP)
                } catch (e: Exception) {
                    // ベストエフォート
                }
            }
        }
    }

    // MARK: - 送話ロック(talk/start・heartbeat・stop)

    private fun startTalkHeartbeat() {
        stopTalkHeartbeat()
        heartbeatJob = scope.launch {
            while (true) {
                delay(TALK_LOCK_HEARTBEAT_MS)
                try {
                    talkRequest(TalkAction.HEARTBEAT)
                } catch (e: Exception) {
                    // サーバー側で最大発話時間(MAX_HOLD_MS)を超えた等、ロックを失った場合は
                    // ここに来る。本来は次のRoomMetadataChangedでもUIが追従するが、
                    // 念のため即座に強制的に送話を止める。
                    appendLog("発話ロックの延長に失敗しました。送話を終了します: ${e.message}")
                    stopTalking(forced = true)
                    break
                }
            }
        }
    }

    private fun stopTalkHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    private suspend fun talkRequest(action: TalkAction) = withContext(Dispatchers.IO) {
        val provider = idTokenProvider ?: throw TokenFetchException(401, "サインインしていません")
        val idToken = provider()

        val encodedRoomId = java.net.URLEncoder.encode(roomName, "UTF-8")
        val url = "${tokenServerUrl.trimEnd('/')}/rooms/$encodedRoomId/talk/${action.path}"
        val request = Request.Builder()
            .url(url)
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
                } ?: "発話ロックの操作に失敗しました (HTTP ${response.code})"
                throw TokenFetchException(response.code, message)
            }
        }
    }

    /**
     * LiveKitのRoom Metadata(JSON文字列)から currentTalker(uid) を取り出す。
     * token-server/lib/roomMetadata.js が書き込む `{ currentTalker, recording, updatedAt }`
     * の形式を前提にしている。パース失敗時はnull(=誰も発話中でない)として扱う。
     */
    private fun parseCurrentTalker(metadata: String?): String? {
        if (metadata.isNullOrEmpty()) return null
        return try {
            val json = JSONObject(metadata)
            if (json.isNull("currentTalker")) return null
            json.optString("currentTalker").takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            null
        }
    }

    // MARK: - トークン取得

    private suspend fun fetchToken(): String = withContext(Dispatchers.IO) {
        val provider = idTokenProvider
            ?: throw TokenFetchException(401, "サインインしていません")
        val idToken = provider()

        val encodedRoom = java.net.URLEncoder.encode(roomName, "UTF-8")
        val url = "${tokenServerUrl.trimEnd('/')}/token?room=$encodedRoom"
        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $idToken")
            .build()

        httpClient.newCall(request).execute().use { response ->
            val body = response.body?.string()
            if (response.code != 200) {
                val message = try {
                    body?.let { JSONObject(it).optString("error").takeIf { s -> s.isNotEmpty() } }
                } catch (e: Exception) {
                    null
                } ?: "トークン取得に失敗しました (HTTP ${response.code})"
                throw TokenFetchException(response.code, message)
            }
            JSONObject(body ?: "{}").getString("token")
        }
    }

    // MARK: - RoomEvent購読

    private fun observeEvents(target: Room) {
        eventJob?.cancel()
        eventJob = scope.launch {
            target.events.collect { event ->
                handleEvent(target, event)
            }
        }
    }

    private fun handleEvent(target: Room, event: RoomEvent) {
        when (event) {
            is RoomEvent.Disconnected -> {
                appendLog("切断されました: ${event.reason}")
                _participants.value = emptyMap()
                _isSending.value = false
                _currentTalkerUid.value = null
                room = null
                if (_status.value !is ConnectionStatus.Error) {
                    _status.value = ConnectionStatus.Disconnected
                }
            }

            is RoomEvent.Reconnecting -> {
                appendLog("再接続を開始しました")
                if (_status.value !is ConnectionStatus.Error) {
                    _status.value = ConnectionStatus.Reconnecting(roomName)
                }
            }

            is RoomEvent.Reconnected -> {
                appendLog("再接続に成功しました")
                if (_status.value !is ConnectionStatus.Error) {
                    _status.value = ConnectionStatus.Connected(roomName)
                }
                // 再接続の間に発話ロックの状態が変わっている可能性があるため、
                // 最新のRoom Metadataから読み直しておく。
                _currentTalkerUid.value = parseCurrentTalker(target.metadata)
            }

            is RoomEvent.FailedToConnect -> {
                appendLog("接続失敗: ${event.error?.message ?: "不明なエラー"}")
                _status.value = ConnectionStatus.Error(event.error?.message ?: "接続失敗")
            }

            is RoomEvent.ParticipantConnected -> {
                val id = event.participant.identity?.value ?: "?"
                appendLog("参加: $id")
                // ParticipantConnected発火時点で既にトラック情報(publish済みか)を
                // 持っている場合があるため、初期同期時と同じくmutedを実際の値から取得する。
                // 音声トラックがまだ無い参加者は安全側に倒して「未送話」扱いにする。
                val muted = event.participant.trackPublications.values
                    .firstOrNull { it.kind == Track.Kind.AUDIO }?.muted ?: true
                _participants.update { it + (id to ParticipantInfo(identity = id, name = event.participant.name ?: id, muted = muted)) }
            }

            is RoomEvent.ParticipantDisconnected -> {
                val id = event.participant.identity?.value ?: "?"
                appendLog("退出: $id")
                _participants.update { it - id }
            }

            is RoomEvent.RoomMetadataChanged -> {
                // routes/talk.js(→lib/roomMetadata.js)がRoomServiceClient.updateRoomMetadata()
                // で書き込む { currentTalker, recording, updatedAt } の変化を受け取る。
                // イベント自体のペイロードのフィールド名はSDKバージョンで変わりうるため依存せず、
                // 保持しているRoomオブジェクトの最新metadataを都度読み直す実装にしている。
                _currentTalkerUid.value = parseCurrentTalker(target.metadata)
                appendLog("[診断] メタデータ更新受信: currentTalker=${_currentTalkerUid.value ?: "null"}")
            }

            is RoomEvent.TrackMuted -> {
                val identity = event.participant.identity?.value
                if (event.publication.kind == Track.Kind.AUDIO && identity != null) {
                    _participants.update { map -> map[identity]?.let { info -> map + (identity to info.copy(muted = true)) } ?: map }
                }
            }

            is RoomEvent.TrackUnmuted -> {
                val identity = event.participant.identity?.value
                if (event.publication.kind == Track.Kind.AUDIO && identity != null) {
                    _participants.update { map -> map[identity]?.let { info -> map + (identity to info.copy(muted = false)) } ?: map }
                }
            }

            else -> {
                // 他のイベント(TrackSubscribed等)は現状UIに影響しないため無視する。
                // 音声トラックのアタッチ/再生自体はLiveKit Android SDKが自動的に行う。
            }
        }
    }

    // MARK: - Log

    private fun appendLog(line: String) {
        val timestamp = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        _logLines.update { current ->
            val updated = current + "[$timestamp] $line"
            if (updated.size > 200) updated.takeLast(200) else updated
        }
    }
}