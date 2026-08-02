/**
 * MainActivity.kt
 *
 * Web版(ptt-client/public/index.html)・iOS版(ContentView.swift)と同等のUI:
 * (初回起動時のみ)オンボーディング → Googleサインイン → ルーム作成/招待コード参加 →
 * PTTボタン → 送話中リスト → チャット → ログ
 *
 * Google Sign-InのIntent起動とマイク権限リクエストはActivity側の責務のため、
 * ここでActivityResultLauncherを保持し、結果だけを各Managerへ橋渡しする。
 */
package co.ubunifu.pttandroid

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import co.ubunifu.pttandroid.auth.PTTAuthManager
import co.ubunifu.pttandroid.badges.PTTBadgesStore
import co.ubunifu.pttandroid.orgcontext.PTTOrgContextStore
import co.ubunifu.pttandroid.ban.PTTBanStore
import co.ubunifu.pttandroid.chat.PTTChatStore
import co.ubunifu.pttandroid.connection.PTTConnectionManager
import co.ubunifu.pttandroid.connection.PTTForegroundService
import co.ubunifu.pttandroid.onboarding.PTTOnboardingStore
import co.ubunifu.pttandroid.recording.PTTRecordingStore
import co.ubunifu.pttandroid.report.PTTReportStore
import co.ubunifu.pttandroid.room.PTTRoomManager
import co.ubunifu.pttandroid.room.PTTSavedRoomsStore
import co.ubunifu.pttandroid.settings.PTTSettingsStore
import co.ubunifu.pttandroid.ui.PTTApp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var authManager: PTTAuthManager

    private var micPermissionGranted = mutableStateOf(false)

    private val requestMicPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> micPermissionGranted.value = granted }

    // [Phase9] 通知権限(Android 13+)。拒否されてもフォアグラウンドサービス自体は動くため
    // (常駐通知が見えないだけ)、結果を特に保持・分岐には使わない。ユーザーへ理由を伝える
    // タイミングは今後のUX検討課題(ひとまずRECORD_AUDIOと同じ「起動時にまとめて聞く」方式)。
    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* no-op */ }

    // [Phase9] PTTConnectionManagerの所有者をMainActivityからPTTForegroundServiceへ移した。
    // Activityの生存期間に縛られず接続(LiveKit Room)を保持し、バックグラウンドでも
    // 送受話を継続するため。bindService()で取得したインスタンスをCompose側へ渡す
    // (connect()/disconnect()等のAPI自体はPTTConnectionManager側で変更していないため、
    // PTTApp.kt以下は無変更で動く)。
    private var connectionManagerState = mutableStateOf<PTTConnectionManager?>(null)
    private var foregroundServiceConnection: ServiceConnection? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // [不具合調査用] ファイル選択画面から戻るとルーム選択画面まで戻ってしまう件。
        // savedInstanceStateがnullでない=システムがこのActivity(≒プロセス)を一度
        // 破棄して再生成したことを意味する。identityHashCodeも合わせて出すことで、
        // logcat上で「同一インスタンスの通常のonCreate再呼び出し」ではなく
        // 「別インスタンスとして新規に生成された」ことを区別できるようにする。
        Log.d(
            TAG,
            "onCreate: this=${System.identityHashCode(this)} " +
                "savedInstanceState=${if (savedInstanceState != null) "present(=再生成)" else "null(=初回起動)"}",
        )

        authManager = PTTAuthManager(
            context = applicationContext,
            webClientId = getString(R.string.default_web_client_id),
        )

        micPermissionGranted.value = ContextCompat.checkSelfPermission(
            this, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        val signInLauncher = registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            lifecycleScope.launch {
                authManager.handleSignInResult(result.data)
            }
        }

        // [Phase9] Serviceを明示的に起動しておく(bindServiceだけだとunbind時に
        // 自動的に破棄されてしまい、Activityがバックグラウンドに回った瞬間に
        // 接続が切れてしまう)。plain startService()はこの呼び出し自体がアプリ
        // フォアグラウンド中(起動直後)であれば常に許可されるため、
        // startForegroundService()特有の「即座にstartForeground()を呼ぶ」制約を
        // 受けない。実際にstartForeground()するかどうかはService側が接続状態を見て
        // 自律的に判断する(PTTForegroundService.observeConnectionState()参照)。
        startService(Intent(this, PTTForegroundService::class.java))

        setContent {
            val roomManager = remember { PTTRoomManager(applicationContext) }
            val savedRoomsStore = remember { PTTSavedRoomsStore(applicationContext) }
            // [Phase9] PTTForegroundServiceへのbind完了まではnull。bindは同一プロセス内
            // なのでほぼ即時に解決するが、念のため下でnullガードしてから描画する。
            val connectionManager = connectionManagerState.value
            val chatStore = remember { PTTChatStore(applicationContext) }
            val banStore = remember { PTTBanStore(applicationContext) }
            val recordingStore = remember { PTTRecordingStore(applicationContext) }
            val reportStore = remember { PTTReportStore(applicationContext) }
            // [Phase13・次アクションitem3] 参加者一覧のバッジ表示(ポーリング)。
            // Web版(stores/badges.ts)の移植(iOS版は本項目item3としてまだ未実装)。
            val badgesStore = remember { PTTBadgesStore(applicationContext) }
            // [パンくず表示] 組織階層のパンくずをRoom詳細画面に表示する。
            // Web版(stores/orgContext.ts)・iOS版(PTTOrgContextStore.swift)の移植。
            val orgContextStore = remember { PTTOrgContextStore(applicationContext) }
            // [オンボーディング] 初回起動時のスワイプ形式チュートリアルの完了状態
            // (SharedPreferencesベース。Web版のonboarding.ts/iOS版のPTTOnboardingStore.swiftと同じ設計)。
            val onboardingStore = remember { PTTOnboardingStore(applicationContext) }
            // [設定画面] サーバー接続先(トークンサーバーURL/LiveKit URL)の永続化ストア。
            // Web版stores/settings.ts・iOS版PTTSettingsStore.swiftと同じ設計(2026-07-29)。
            val settingsStore = remember { PTTSettingsStore(applicationContext) }

            LaunchedEffect(Unit) {
                if (!micPermissionGranted.value) {
                    requestMicPermission.launch(Manifest.permission.RECORD_AUDIO)
                }
            }

            MaterialTheme {
                Surface {
                    // targetSdk 35(Android 15)ではデフォルトでedge-to-edge描画になり、
                    // 何もしないとヘッダー行がステータスバー/カメラのくり抜き部分と重なって
                    // しまう(サインアウト操作が押せなくなる不具合の原因)。safeDrawing insetsを
                    // 明示的に余白として消費し、ノッチ・ステータスバー・ナビゲーションバーの
                    // 内側にコンテンツ全体を収める。
                    Box(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing)) {
                        // [Phase9] PTTForegroundServiceへのbindはほぼ即時だが、
                        // 理論上は最初の1フレームだけnullになりうるため空描画で待つ。
                        if (connectionManager != null) {
                        PTTApp(
                            authManager = authManager,
                            roomManager = roomManager,
                            savedRoomsStore = savedRoomsStore,
                            connectionManager = connectionManager,
                            chatStore = chatStore,
                            banStore = banStore,
                            recordingStore = recordingStore,
                            reportStore = reportStore,
                            badgesStore = badgesStore,
                            orgContextStore = orgContextStore,
                            onboardingStore = onboardingStore,
                            settingsStore = settingsStore,
                            onRequestGoogleSignIn = { signInLauncher.launch(authManager.signInIntent()) },
                        )
                        }
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        Log.d(TAG, "onStart: this=${System.identityHashCode(this)}")
        // [Phase9] PTTForegroundServiceへbindし、Compose側へconnectionManagerを渡す。
        // startService()は既にonCreate()で呼び済みのため、ここでunbindしても
        // (=Activityがバックグラウンドに回っても)Serviceおよび接続は生き続ける。
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
                val service = (binder as? PTTForegroundService.LocalBinder)?.service ?: return
                connectionManagerState.value = service.connectionManager
            }

            override fun onServiceDisconnected(name: ComponentName?) {
                connectionManagerState.value = null
            }
        }
        foregroundServiceConnection = connection
        bindService(
            Intent(this, PTTForegroundService::class.java),
            connection,
            Context.BIND_AUTO_CREATE,
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onStop() {
        super.onStop()
        Log.d(TAG, "onStop: this=${System.identityHashCode(this)} isFinishing=$isFinishing isChangingConfigurations=$isChangingConfigurations")
        // [不具合調査・原因確定 2026-07-28、二度目の実機検証で判明]
        // 前回のコメント(rememberSaveable化で十分、という判断)は誤りだった。
        // 実機ログ+スクリーンショットで、ヘッダーの`channelLabel`(status.Connected時に
        // "room: xxx"を表示。PTTConnectionManager側は生存しているため接続は維持されたまま)が
        // 表示されているにもかかわらず、画面本体はactiveRoomId==nullの
        // ルーム選択画面になっている状態を確認した。つまりrememberSaveableにしても
        // activeRoomIdはリセットされ続けている。
        //
        // rememberSaveableが値を復元できるのは、Activity本体が実際に
        // onSaveInstanceState→(再生成時に)onCreate(savedInstanceState)という
        // 保存・復元サイクルを通った場合が前提。今回のようにActivity自体は
        // 破棄されず、`if (connectionManager != null) { PTTApp(...) }` という
        // 条件分岐だけで PTTApp() の合成部分木が着脱される場合、この着脱は
        // 上記の保存・復元サイクルを経由しないため、rememberSaveableで登録した
        // 値も部分木の消滅と一緒に失われる(rememberSaveableStateHolder等の
        // 専用APIを使わない限り、単純なif分岐での着脱までは救えない)。
        //
        // 従って根本原因は「connectionManagerをnullにすることでPTTApp()自体を
        // 毎回丸ごと着脱させていた、このconnectionManagerState.value = null」
        // そのものだった。これを廃止し、bindServiceの参照だけを解除して
        // Compose側が保持するconnectionManagerの参照はそのまま残す。
        // PTTForegroundServiceは同一プロセス内で動くstartService()由来の
        // フォアグラウンドサービスであり、Activity不在中もプロセスごと
        // 生存し続けるため、unbind後もこのKotlinオブジェクト参照へメソッド呼び出しを
        // 行うこと自体は安全(AIDL越しの別プロセスBinderのように無効化されるわけではない)。
        // onStart()で再bindした際は同一インスタンスが返るだけであり、実質的な変化はない。
        foregroundServiceConnection?.let { unbindService(it) }
        foregroundServiceConnection = null
        // [根本修正] ここで connectionManagerState.value = null していたのが原因。廃止。
    }

    override fun onDestroy() {
        super.onDestroy()
        // [不具合調査用] ファイル選択画面が前面にある間にこれが呼ばれていれば、
        // 「戻る」で見えている画面はこのインスタンスではなく、後続のonCreate()で
        // 新規生成された(=状態が空の)別インスタンスであることが確定する。
        Log.d(TAG, "onDestroy: this=${System.identityHashCode(this)} isFinishing=$isFinishing")
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
