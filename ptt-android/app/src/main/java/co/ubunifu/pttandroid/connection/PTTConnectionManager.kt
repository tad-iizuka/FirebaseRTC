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
 * [注意] LiveKit Android SDKはバージョンによってAPIの细部(イベントの型・
 * メソッド名)が変わることがある。ここでは 2.x 系の`Room.events`
 * (Flow<RoomEvent>を購読するスタイル)を前提にしている。導入時は
 * 実際に依存させたバージョンのドキュメント/サンプルアプリと突き合わせること。
 * https://github.com/livekit/client-sdk-android
 */
package co.ubunifu.pttandroid.connection

import android.content.Context
import co.ubunifu.pttandroid.model.ConnectionStatus
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
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

    private val _talkers = MutableStateFlow<Set<String>>(emptySet())
    val talkers: StateFlow<Set<String>> = _talkers

    private val _logLines = MutableStateFlow<List<String>>(emptyList())
    val logLines: StateFlow<List<String>> = _logLines

    private val _isSending = MutableStateFlow(false)
    val isSending: StateFlow<Boolean> = _isSending

    private var room: Room? = null
    private var tokenServerUrl: String = ""
    private var livekitUrl: String = ""
    private var roomName: String = ""
    private var idTokenProvider: (suspend () -> String)? = null
    private var eventJob: Job? = null

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
        scope.launch {
            eventJob?.cancel()
            current.disconnect()
            room = null
            _talkers.value = emptySet()
            _isSending.value = false
            _status.value = ConnectionStatus.Disconnected
            appendLog("切断しました")
        }
    }

    /** PTTボタンが押された */
    fun startTalking() {
        val current = room ?: return
        if (_status.value !is ConnectionStatus.Connected || _isSending.value) return
        _isSending.value = true
        scope.launch {
            try {
                current.localParticipant.setMicrophoneEnabled(true)
            } catch (e: Exception) {
                appendLog("マイク有効化エラー: ${e.message}")
                _isSending.value = false
            }
        }
    }

    /** PTTボタンが離された */
    fun stopTalking() {
        val current = room ?: return
        if (!_isSending.value) return
        _isSending.value = false
        scope.launch {
            try {
                current.localParticipant.setMicrophoneEnabled(false)
            } catch (e: Exception) {
                appendLog("マイク無効化エラー: ${e.message}")
            }
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
                handleEvent(event)
            }
        }
    }

    private fun handleEvent(event: RoomEvent) {
        when (event) {
            is RoomEvent.Disconnected -> {
                appendLog("切断されました: ${event.reason}")
                _talkers.value = emptySet()
                _isSending.value = false
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
            }

            is RoomEvent.FailedToConnect -> {
                appendLog("接続失敗: ${event.error?.message ?: "不明なエラー"}")
                _status.value = ConnectionStatus.Error(event.error?.message ?: "接続失敗")
            }

            is RoomEvent.ParticipantConnected -> {
                appendLog("参加: ${event.participant.identity}")
            }

            is RoomEvent.ParticipantDisconnected -> {
                val id = event.participant.identity?.value ?: "?"
                appendLog("退出: $id")
                _talkers.update { it - id }
            }

            is RoomEvent.RoomMetadataChanged -> {
                // routes/talk.jsが書き込む { currentTalker, updatedAt } はUI側では
                // talkers(mute/unmute)だけで十分表現できるため、ここではログのみ出す。
                appendLog("[診断] メタデータ更新受信")
            }

            is RoomEvent.TrackMuted -> {
                val identity = event.participant.identity?.value
                if (event.publication.kind == Track.Kind.AUDIO && identity != null) {
                    _talkers.update { it - identity }
                }
            }

            is RoomEvent.TrackUnmuted -> {
                val identity = event.participant.identity?.value
                if (event.publication.kind == Track.Kind.AUDIO && identity != null) {
                    _talkers.update { it + identity }
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
