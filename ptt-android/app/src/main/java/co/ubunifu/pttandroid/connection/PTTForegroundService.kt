/**
 * PTTForegroundService.kt
 *
 * [Phase9 バックグラウンド動作]
 * これまで PTTConnectionManager は MainActivity の Compose ツリーで
 * `remember { PTTConnectionManager(...) }` として生成されており、Activityが
 * 破棄される(バックグラウンドで長時間放置されOSに殺される、画面回転以外の
 * 理由で再生成される等)と接続ごと失われていた。また、Android 9以降は
 * バックグラウンドのプロセスからのマイク使用が制限されるため、フォアグラウンド
 * サービス化なしには「アプリを閉じても送受話が続く」体験は実現できない
 * (iOS版のUIBackgroundModes=audioに相当する仕組みがAndroidには無く、
 * 明示的なForegroundServiceが必須)。
 *
 * この Service が PTTConnectionManager の"所有者"になることで:
 *   - Activity の生存期間に関わらず接続(LiveKit Roomオブジェクト)を保持する
 *   - status が Connected/Reconnecting/Connecting の間だけ
 *     startForeground()し、切断されたら降格する(ルーム未参加中に常駐通知は出さない)
 *   - 常駐通知に「送話開始/終了」アクションを出し、タップで送話をトグルできる
 *   - MediaSession経由で、Bluetoothヘッドセット等の物理ボタン
 *     (KEYCODE_HEADSETHOOK/KEYCODE_MEDIA_PLAY_PAUSE)によるPTT操作、および
 *     ロック画面/クイック設定のNow Playing風コントロールからの送話トグルに対応する
 *
 * MainActivity は本Serviceに bindService() し、バインダー経由で
 * connectionManager インスタンスを取得して PTTApp(Composable) に渡す。
 * connect()/disconnect()/startTalking()/stopTalking() のAPI自体は
 * PTTConnectionManager 側で変更していないため、PTTApp.kt 側の呼び出し
 * コードは無変更で動く。
 *
 * [制約・注意]
 * - 通知アイコン・チャンネル文言は最小限。デザインの作り込みは別途検討。
 * - MediaStyle通知(androidx.media の MediaSessionCompat.Token 連携)は
 *   追加ライブラリ依存を避けるため今回は見送り、素の通知アクションのみ。
 *   ロック画面の見栄えを良くしたい場合は androidx.media:media の導入を検討する。
 * - ヘッドセットの物理ボタンは「押している間だけ送話」(ACTION_DOWN/ACTION_UP)、
 *   通知アクション・Now Playing風コントロールは「タップでトグル」と、
 *   入力手段によって挙動が異なる。物理ボタンは画面上のPTTボタンと同じ
 *   hold-to-talk体験に揃え、タップ操作しかできない手段はトグルにする方針。
 * - 実機での動作検証(Doze/App Standby、メーカー独自の電力最適化によるkillなど)
 *   はこのドキュメント作成時点では未実施。実機検証を次アクションとして残す。
 */
package co.ubunifu.pttandroid.connection

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.IntentCompat
import co.ubunifu.pttandroid.MainActivity
import co.ubunifu.pttandroid.R
import co.ubunifu.pttandroid.model.ConnectionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class PTTForegroundService : Service() {

    inner class LocalBinder : Binder() {
        val service: PTTForegroundService get() = this@PTTForegroundService
    }

    private val binder = LocalBinder()

    // Activityのライフサイクルに縛られない、Service自身が持つスコープ。
    // onDestroy()でキャンセルするため、bindが外れてもServiceが生きている限り
    // (=MainActivity.onCreate()のstartService()で起動されている限り)接続処理は継続する。
    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.Main.immediate + serviceJob)

    /** MainActivity(PTTApp.kt)へそのまま渡す、この Service が所有する唯一のインスタンス */
    lateinit var connectionManager: PTTConnectionManager
        private set

    private lateinit var mediaSession: MediaSession
    private var isForegroundActive = false
    private var observeJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        connectionManager = PTTConnectionManager(applicationContext, serviceScope)
        createNotificationChannel()
        setupMediaSession()
        observeConnectionState()
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE_TALK -> toggleTalking()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        observeJob?.cancel()
        mediaSession.release()
        serviceJob.cancel()
        super.onDestroy()
    }

    // MARK: - 送話トグル(通知アクション・MediaSession共通)

    private fun toggleTalking() {
        if (connectionManager.isSending.value) {
            connectionManager.stopTalking()
        } else {
            connectionManager.startTalking()
        }
    }

    // MARK: - MediaSession(ヘッドセットボタン・Now Playing風コントロール)

    private fun setupMediaSession() {
        mediaSession = MediaSession(this, "PTTMediaSession").apply {
            setCallback(object : MediaSession.Callback() {
                // ロック画面/クイック設定のトランスポートコントロールからのタップ
                // (=タップでトグル。押しっぱなし判定はできない領域のため)
                override fun onPlay() {
                    connectionManager.startTalking()
                }

                override fun onPause() {
                    connectionManager.stopTalking()
                }

                // Bluetoothヘッドセット等、物理ボタンからのイベント。
                // ACTION_DOWN/ACTION_UPが両方渡ってくるため、画面上のPTTボタンと同じ
                // 「押している間だけ送話」を再現できる。
                override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
                    val keyEvent = IntentCompat.getParcelableExtra(
                        mediaButtonIntent, Intent.EXTRA_KEY_EVENT, KeyEvent::class.java
                    ) ?: return super.onMediaButtonEvent(mediaButtonIntent)

                    val isPttKey = keyEvent.keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
                        keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                    if (!isPttKey) return super.onMediaButtonEvent(mediaButtonIntent)

                    when (keyEvent.action) {
                        KeyEvent.ACTION_DOWN -> if (keyEvent.repeatCount == 0) connectionManager.startTalking()
                        KeyEvent.ACTION_UP -> connectionManager.stopTalking()
                    }
                    return true
                }
            })
        }
    }

    private fun updateMediaSessionPlaybackState(isSending: Boolean, roomName: String?) {
        val state = if (isSending) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        mediaSession.setPlaybackState(
            PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE)
                .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build()
        )
        if (roomName != null) {
            mediaSession.setMetadata(
                android.media.MediaMetadata.Builder()
                    .putString(android.media.MediaMetadata.METADATA_KEY_TITLE, roomName)
                    .putString(
                        android.media.MediaMetadata.METADATA_KEY_ARTIST,
                        getString(R.string.notification_channel_name)
                    )
                    .build()
            )
        }
    }

    // MARK: - 接続状態の監視 → フォアグラウンド昇格/降格・通知更新

    private fun observeConnectionState() {
        observeJob?.cancel()
        observeJob = serviceScope.launch {
            combine(
                connectionManager.status,
                connectionManager.isSending,
                connectionManager.currentTalkerUid,
            ) { status, sending, talker -> Triple(status, sending, talker) }
                .collect { (status, sending, talker) ->
                    val roomName = (status as? ConnectionStatus.Connected)?.room
                        ?: (status as? ConnectionStatus.Reconnecting)?.room
                    updateMediaSessionPlaybackState(sending, roomName)

                    val shouldStayForeground = status is ConnectionStatus.Connecting ||
                        status is ConnectionStatus.Connected ||
                        status is ConnectionStatus.Reconnecting

                    if (shouldStayForeground) {
                        promoteToForeground(status, sending, talker)
                    } else {
                        demoteFromForeground()
                    }
                }
        }
    }

    private fun promoteToForeground(status: ConnectionStatus, sending: Boolean, talker: String?) {
        val notification = buildNotification(status, sending, talker)
        if (!isForegroundActive) {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
            isForegroundActive = true
            mediaSession.isActive = true
        } else {
            NotificationManagerCompatHelper.notify(this, NOTIFICATION_ID, notification)
        }
    }

    private fun demoteFromForeground() {
        if (!isForegroundActive) return
        mediaSession.isActive = false
        // stopForeground(int)はAPI24+の現行API(boolean版が非推奨)。
        stopForeground(STOP_FOREGROUND_REMOVE)
        isForegroundActive = false
    }

    // MARK: - 通知

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW, // 音・バイブなしの常駐通知(接続状態の可視化が目的)
        ).apply {
            description = getString(R.string.notification_channel_description)
            setShowBadge(false)
        }
        manager?.createNotificationChannel(channel)
    }

    private fun buildNotification(status: ConnectionStatus, sending: Boolean, talker: String?): Notification {
        val title = when (status) {
            is ConnectionStatus.Connected -> getString(R.string.notification_title_connected, status.room)
            is ConnectionStatus.Reconnecting -> getString(R.string.notification_title_reconnecting, status.room)
            else -> getString(R.string.notification_title_connecting)
        }
        val text = when {
            sending -> getString(R.string.notification_text_sending)
            talker != null -> getString(R.string.notification_text_other_talking)
            else -> getString(R.string.notification_text_idle)
        }
        val talkActionTitle = if (sending) {
            getString(R.string.notification_action_talk_stop)
        } else {
            getString(R.string.notification_action_talk_start)
        }
        val toggleIntent = PendingIntent.getService(
            this,
            0,
            Intent(this, PTTForegroundService::class.java).setAction(ACTION_TOGGLE_TALK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_ptt)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(contentIntent)
            // 他人が発話中/未接続でもタップ自体は無効化できないが、
            // startTalking()側で二重にガードされているため誤操作の実害はない。
            .addAction(0, talkActionTitle, toggleIntent)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "ptt_status_channel"
        private const val NOTIFICATION_ID = 1001
        const val ACTION_TOGGLE_TALK = "co.ubunifu.pttandroid.action.TOGGLE_TALK"
    }
}

/**
 * NotificationManagerCompat.notify() 呼び出し時、POST_NOTIFICATIONS権限が
 * 拒否されているとSecurityExceptionを投げるAPIレベルがあるため、一箇所に
 * まとめてtry-catchする(フォアグラウンドサービス自体は権限が無くても
 * 継続でき、通知が見えないだけになる。落とすべきではない)。
 */
private object NotificationManagerCompatHelper {
    fun notify(service: Service, id: Int, notification: Notification) {
        try {
            androidx.core.app.NotificationManagerCompat.from(service).notify(id, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS未許可。フォアグラウンド状態自体は維持されるため無視してよい。
        }
    }
}
