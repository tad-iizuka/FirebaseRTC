/**
 * PTTApp.kt
 *
 * [LiveKit移行 + Firebase Auth対応 + 招待制ルーム対応 + Phase5テキストチャット + 送話ロック連携 + オンボーディング]
 * Web版(ptt-client/public/index.html)・iOS版(ContentView.swift)と同等のUI:
 * (初回起動時のみ)オンボーディング → Googleサインイン → ルーム作成/招待コード参加 →
 * PTTボタン → 送話中リスト → チャット → ログ
 *
 * クライアントIDの手入力は行わない(token-serverは常にFirebase ID Token由来のuidを
 * identityとして使うため)。ルームIDの直接入力による接続も行わず、token-serverの
 * invite_only設計(POST /rooms でルーム作成、POST /rooms/:roomId/join で招待コード検証)
 * に合わせている。
 *
 * [送話ロック連携]
 * PTTConnectionManager が token-server の /talk/start・/talk/heartbeat・/talk/stop
 * (token-server/routes/talk.js)を呼び出し、サーバー側で排他制御を強制する。
 * このComposable側は connectionManager.currentTalkerUid を見て、自分以外が
 * 発話ロックを保持している間はPTTボタンのタップ判定を無効化し、
 * 「誰が話しているか」を表示するだけに留める(実際のロック取得/延長/解放ロジックは
 * すべてPTTConnectionManagerに集約されている)。
 *
 * [オンボーディング]
 * Web版(ptt-client/src/App.vue)・iOS版(ContentView.swift)と同じ設計判断:
 * onboardingStore.hasCompletedOnboarding が false の間は、サインイン状態に関わらず
 * スワイプ形式の紹介画面(PTTOnboardingScreen)を最優先で表示する。
 */
package co.ubunifu.pttandroid.ui

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.ubunifu.pttandroid.R
import co.ubunifu.pttandroid.auth.PTTAuthManager
import co.ubunifu.pttandroid.badges.PTTBadgesStore
import co.ubunifu.pttandroid.orgcontext.OrgContext
import co.ubunifu.pttandroid.orgcontext.PTTOrgContextStore
import co.ubunifu.pttandroid.ban.PTTBanStore
import co.ubunifu.pttandroid.ban.PTTRoomPermissions
import co.ubunifu.pttandroid.chat.PTTChatStore
import co.ubunifu.pttandroid.connection.PTTConnectionManager
import co.ubunifu.pttandroid.invite.PendingInvite
import co.ubunifu.pttandroid.model.AssignedBadge
import co.ubunifu.pttandroid.model.AttachmentKind
import co.ubunifu.pttandroid.model.ConnectionStatus
import co.ubunifu.pttandroid.model.ParticipantInfo
import co.ubunifu.pttandroid.onboarding.PTTOnboardingScreen
import co.ubunifu.pttandroid.onboarding.PTTOnboardingStore
import co.ubunifu.pttandroid.recording.PTTRecordingStore
import co.ubunifu.pttandroid.report.PTTReportStore
import co.ubunifu.pttandroid.room.PTTRoomManager
import co.ubunifu.pttandroid.room.PTTSavedRoomsStore
import co.ubunifu.pttandroid.room.RoomSchedule
import co.ubunifu.pttandroid.room.SavedRoom
import co.ubunifu.pttandroid.settings.PTTServerPreset
import co.ubunifu.pttandroid.settings.PTTSettingsStore
import co.ubunifu.pttandroid.ui.theme.PTTColors
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private val Mono = FontFamily.Monospace

/** [不具合調査用] ファイル選択画面から戻ると在室中のルームが失われる件のログタグ。 */
private const val TAG = "PTTApp"

/**
 * [表示仕様・2026-08-06] 開始/終了時刻をローカル履歴一覧の下段用に整形する。
 * どちらも未指定なら空文字(行自体は残すが空欄表示)。Web版SavedRoomsList.vueの
 * scheduleLabel()・iOS版ContentView.scheduleLabel()と同じ考え方
 * (start/endどちらか片方だけの場合も考慮)。
 */
private fun scheduleLabel(schedule: RoomSchedule?): String {
    if (schedule == null || (schedule.start == null && schedule.end == null)) return ""
    val formatter = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
    fun format(ms: Long) = formatter.format(Date(ms))
    return when {
        schedule.start != null && schedule.end != null -> "${format(schedule.start)} – ${format(schedule.end)}"
        schedule.start != null -> format(schedule.start)
        schedule.end != null -> format(schedule.end)
        else -> ""
    }
}

/**
 * [モバイルUI再編・2026-08-04] iOS版ContentView.swiftのRootTab(private enum)の移植。
 * 通話/参加者/チャット/設定の4タブ構成。サインイン後は常にこの4タブを表示し、
 * 通話タブが未入室時はルーム選択画面、入室中はPTTボタン+退出ボタンを兼ねる。
 * 頻度の低い操作(プロフィール/サインアウト/録音操作/ニックネーム変更/接続設定)は
 * 独立の設定タブ(歯車)に集約する(iOS版と同じ設計判断。brushup-plan.md参照)。
 */
private enum class RootTab { TALK, MEMBERS, CHAT, SETTINGS }

/** [Phase16] ACTION_OPEN_DOCUMENTで選択されたUriの表示名を解決する(送信前の確認行用)。 */
private fun queryDisplayName(context: android.content.Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (cursor.moveToFirst() && nameIdx >= 0) {
            cursor.getString(nameIdx)?.let { return it }
        }
    }
    return uri.lastPathSegment ?: "file"
}

@Composable
fun PTTApp(
    authManager: PTTAuthManager,
    roomManager: PTTRoomManager,
    savedRoomsStore: PTTSavedRoomsStore,
    connectionManager: PTTConnectionManager,
    chatStore: PTTChatStore,
    banStore: PTTBanStore,
    recordingStore: PTTRecordingStore,
    reportStore: PTTReportStore,
    badgesStore: PTTBadgesStore,
    orgContextStore: PTTOrgContextStore,
    onboardingStore: PTTOnboardingStore,
    settingsStore: PTTSettingsStore,
    pendingInvite: PendingInvite? = null,
    onPendingInviteConsumed: () -> Unit = {},
    onRequestGoogleSignIn: () -> Unit,
) {
    // [オンボーディング] 初回起動時はサインイン前でもこの画面を最優先で表示する
    // (Web版App.vue・iOS版ContentView.swiftと同じ優先順位)。完了/スキップで
    // onboardingStore.complete() が呼ばれ、以降の起動では表示されなくなる。
    val hasCompletedOnboarding by onboardingStore.hasCompletedOnboarding.collectAsState()
    if (!hasCompletedOnboarding) {
        PTTOnboardingScreen(onComplete = { onboardingStore.complete() })
        return
    }

    val scope = rememberCoroutineScope()

    // [多言語化] LaunchedEffect/scope.launchのブロックは@Composableコンテキストではないため、
    // stringResource()はここ(コンポーザブル本体)であらかじめ解決しておく必要がある。
    val banNoticeText = stringResource(R.string.room_ban_notice)

    val currentUser by authManager.currentUser.collectAsState()
    val authError by authManager.lastErrorMessage.collectAsState()
    val roomWorking by roomManager.isWorking.collectAsState()
    val roomError by roomManager.lastErrorMessage.collectAsState()
    val savedRooms by savedRoomsStore.rooms.collectAsState()
    val status by connectionManager.status.collectAsState()
    val participants by connectionManager.participants.collectAsState()
    val isSending by connectionManager.isSending.collectAsState()
    val logLines by connectionManager.logLines.collectAsState()
    val chatMessages by chatStore.messages.collectAsState()
    val chatError by chatStore.errorMessage.collectAsState()
    val myRole by banStore.myRole.collectAsState()
    val isBanned by banStore.isBanned.collectAsState()
    val banError by banStore.errorMessage.collectAsState()
    // [Phase10: Guestロール 5.1] 自分自身のニックネーム(displayName)とその更新状態。
    val myDisplayName by banStore.myDisplayName.collectAsState()
    val nicknameUpdating by banStore.nicknameUpdating.collectAsState()
    val nicknameError by banStore.nicknameErrorMessage.collectAsState()
    // [録音UI] Room Metadata経由でPTTConnectionManagerが保持している確定状態。
    val isRecording by connectionManager.isRecording.collectAsState()
    val recordingStartedAt by connectionManager.recordingStartedAt.collectAsState()
    val recordingStarting by recordingStore.starting.collectAsState()
    val recordingStopping by recordingStore.stopping.collectAsState()
    val recordingError by recordingStore.errorMessage.collectAsState()
    // [通報UI]
    val reportSubmitting by reportStore.isSubmitting.collectAsState()
    val reportError by reportStore.errorMessage.collectAsState()
    // [Phase13・次アクションitem3] 参加者一覧のバッジ表示(ポーリング)。
    val badgesByUid by badgesStore.byUid.collectAsState()
    // [2026-08-04・次アクションitem4] Room owner向けバッジ付与/剥奪。ownerでなければ
    // サーバー側からnullが返るため、role判定をここで重複させない(nullなら出さない)。
    val grantableBadges by badgesStore.grantableBadges.collectAsState()
    val badgeGranting by badgesStore.isGranting.collectAsState()
    val badgeGrantError by badgesStore.grantErrorMessage.collectAsState()
    // [パンくず表示] 組織階層。入室時に1回だけ取得(ポーリングしない)。
    val orgContext by orgContextStore.context_.collectAsState()
    // [送話ロック連携] サーバー(routes/talk.js)がRoom Metadataに書き込むcurrentTalker(uid)。
    // 自分以外のuidが入っている間はPTTボタンを無効化する。
    val currentTalkerUid by connectionManager.currentTalkerUid.collectAsState()

    // [2026-07-29] 接続先(tokenServerUrl/livekitUrl)は設定画面(歯車アイコン)へ移設した。
    // 従来は@Stateとして保持し永続化もしていなかったが、PTTSettingsStore(SharedPreferences)
    // から都度導出する形に変更した。プリセット/カスタム値が変わるたびに再計算されるよう、
    // presetIdをcollectAsStateで購読してから読む(単なるgetterプロパティの直接参照では
    // 値が変わっても再コンポーズされないため)。
    val settingsPresetId by settingsStore.presetId.collectAsState()
    val settingsCustomTokenServerUrl by settingsStore.customTokenServerUrl.collectAsState()
    val settingsCustomLivekitUrl by settingsStore.customLivekitUrl.collectAsState()
    val tokenServerUrl = if (settingsPresetId == PTTServerPreset.CUSTOM) {
        settingsCustomTokenServerUrl
    } else {
        PTTSettingsStore.PRODUCTION_TOKEN_SERVER_URL
    }
    val livekitUrl = if (settingsPresetId == PTTServerPreset.CUSTOM) {
        settingsCustomLivekitUrl
    } else {
        PTTSettingsStore.PRODUCTION_LIVEKIT_URL
    }
    var joinRoomId by remember { mutableStateOf("") }
    var joinInviteCode by remember { mutableStateOf("") }

    // [招待リンク/QR] MainActivityがApp Link起動時に検出したroom/codeを、
    // 参加画面の入力欄へ反映するだけの処理(自動参加はしない)。
    // deeplink-qr-join-plan.md参照。反映後はonPendingInviteConsumed()で
    // MainActivity側の状態をクリアし、再コンポーズのたびに再適用されないようにする。
    LaunchedEffect(pendingInvite) {
        val invite = pendingInvite ?: return@LaunchedEffect
        joinRoomId = invite.roomId
        joinInviteCode = invite.inviteCode
        onPendingInviteConsumed()
    }
    var chatInput by remember { mutableStateOf("") }
    // [不具合調査・修正] ファイル選択画面から戻るとルーム内ではなくルーム選択画面に
    // 戻ってしまう不具合の原因調査用。activeRoomId/currentInviteCodeはこれまで
    // 素の remember() だったため、設定変更(configChangesで吸収されない要因)や
    // ドキュメントピッカーのような別Activity表示中にシステムがこのActivityの
    // プロセスを破棄した場合(「アクティビティを保持しない」開発者オプション有効時や
    // 低メモリのエミュレータでの回収)、savedInstanceStateからの再生成時に
    // Compose側の状態が初期値(null)へ戻ってしまい、結果としてactiveRoomId==null＝
    // ルーム選択画面が描画される。rememberSaveable化してBundleへ保存されるようにし、
    // 再生成後も同じルームに在室中だったことを復元できるようにする。
    // [モバイルUI再編・2026-08-04] 入室後に表示中のタブ。iOS版selectedTabの移植。
    // rememberSaveableは他のString?項目と同じ実績のある型(String)で保存し、
    // enum自体の直接保存(Bundleのシリアライズ経路が未検証)は避ける。
    var selectedTabName by rememberSaveable { mutableStateOf(RootTab.TALK.name) }
    val selectedTab = runCatching { RootTab.valueOf(selectedTabName) }.getOrDefault(RootTab.TALK)
    fun setSelectedTab(tab: RootTab) { selectedTabName = tab.name }
    var activeRoomId by rememberSaveable { mutableStateOf<String?>(null) }
    var currentInviteCode by rememberSaveable { mutableStateOf<String?>(null) }
    // [ルーム名] admin-dashboardで設定されたルーム名。POST /rooms/:roomId/join の
    // レスポンス(name)からのみ取得できる(Web版roomStore.currentRoomNameに相当)。
    // 未設定、または保存済みルームからの再入室(/joinを経由しない)時はnullのまま。
    var currentRoomName by rememberSaveable { mutableStateOf<String?>(null) }
    // [BAN対応] BANボタン押下時の確認ダイアログの対象
    var banTarget by remember { mutableStateOf<ParticipantInfo?>(null) }
    // [BAN対応] 自分がBANされてルームを追い出された直後に表示する通知文言
    var banNotice by remember { mutableStateOf<String?>(null) }
    // [録音UI] 開始ボタン押下時の確認ダイアログ表示フラグ
    var showRecordingStartConfirm by remember { mutableStateOf(false) }
    // [通報UI] 通報対象の参加者。入力欄付きダイアログで理由を入力させる
    // (Web版の`window.prompt`・iOS版のtextField付きalertに相当)。
    var reportTarget by remember { mutableStateOf<ParticipantInfo?>(null) }
    var reportReasonText by remember { mutableStateOf("") }
    // [Phase16] 選択直後には送信せず、送信ボタンが押されるまで保持しておくファイル
    // (Web版ChatPanel.vueのpendingFileと同じ設計)。
    var pendingAttachmentUri by remember { mutableStateOf<Uri?>(null) }
    var attachmentSending by remember { mutableStateOf(false) }

    val localContext = LocalContext.current
    val pendingAttachmentName = remember(pendingAttachmentUri) {
        pendingAttachmentUri?.let { queryDisplayName(localContext, it) }
    }
    // [不具合修正・再修正] 一度Intent.createChooser()でラップする実装を試したが、
    // 候補アプリが1つしかない環境では自動転送時に新しいタスクとして起動されてしまい、
    // 「戻る」を押すとアプリのタスクへ戻れず直接ホーム画面に抜けてしまう不具合が
    // 実機検証(Android Studioエミュレータ)で確認された。ACTION_OPEN_DOCUMENTは
    // 元々それ単体で選択元切り替え可能なピッカーUIとして機能する設計であり、
    // createChooser()で包むのは非標準。Google公式のActivityResultContracts.
    // OpenDocument()(chooserラップなし)へ戻し、同一タスク内での通常の
    // back-stack遷移になるようにする。
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        // [不具合調査用] ここに到達した時点でactiveRoomIdが既にnullになっていれば、
        // 「ピッカー表示中にComposeの状態(≒Activity)が失われていた」ことの
        // 直接証拠になる。pickerからの復帰そのものは正常でも、戻ってきた瞬間には
        // 既に別の(状態が空の)コンポジションになっている、というケースを切り分ける。
        Log.d(TAG, "filePickerLauncher result: uri=$uri activeRoomIdAtResult=$activeRoomId")
        if (uri != null) pendingAttachmentUri = uri
    }
    fun launchAttachmentPicker() {
        Log.d(TAG, "launchAttachmentPicker: activeRoomIdBeforeLaunch=$activeRoomId")
        filePickerLauncher.launch(PTTChatStore.ALLOWED_MIME_TYPES)
    }

    // [送話ロック連携] 自分以外が発話ロックを保持しているか、および相手の表示名
    val someoneElseIsTalking = currentTalkerUid != null && currentTalkerUid != currentUser?.uid
    val currentTalkerName = currentTalkerUid?.let { uid -> participants[uid]?.name ?: uid } ?: ""

    LaunchedEffect(currentUser?.uid) {
        savedRoomsStore.load(currentUser?.uid)
        // [不具合修正・2026-08-04(iOS 7訂の移植)] 設定タブでサインアウト→再サインインすると、
        // selectedTabが設定タブのまま残ってしまう。未サインイン画面自体はタブを持たないため
        // 気づきにくいが、サインイン成功(uidが非nullになった瞬間)には常にメインタブである
        // 通話タブへ戻すのが自然な挙動と判断し、ここでリセットする。
        if (currentUser?.uid != null) setSelectedTab(RootTab.TALK)
    }

    // [不具合調査・修正] enterRoom()はこれまでactiveRoomIdの設定と各Storeの
    // start()/connect()呼び出しを同時に行っていたが、これだと「ユーザーが
    // 明示的に参加ボタンを押した瞬間」しか各Storeが起動しない。activeRoomIdを
    // rememberSaveableにしてActivity再生成後も値が復元されるようにしても、
    // chatStore/banStore/badgesStoreはMainActivity側でremember{}生成される
    // (=再生成のたびに作り直される)新しいインスタンスのため、start()を
    // 呼び直さない限り購読が始まらずルーム画面が実質的に機能しない。
    // activeRoomId(復元された値を含む)を購読するLaunchedEffectに一本化し、
    // 「明示的な参加」と「状態復元後の再開」の両方をここでカバーする。
    // connectionManager.connect()自体は`room != null`なら即returnする
    // (PTTConnectionManager.kt)ため、既にPTTForegroundService経由で接続済みの
    // 場合(=Activityだけが再生成された通常のケース)に呼んでも安全。
    LaunchedEffect(activeRoomId, currentUser?.uid) {
        val roomId = activeRoomId ?: return@LaunchedEffect
        val uid = currentUser?.uid
        if (uid == null) {
            // authManagerがサインイン状態を復元し切る前(Activity再生成直後の
            // 数フレーム)は uid が一時的にnullになりうる。currentUser?.uid を
            // keyに含めているため、復元完了時に自動的に再実行される。
            Log.d(TAG, "resume-room-effect: uid not ready yet, waiting (roomId=$roomId)")
            return@LaunchedEffect
        }
        Log.d(TAG, "resume-room-effect: starting stores for roomId=$roomId uid=$uid")
        chatStore.start(roomId)
        banStore.start(roomId, uid)
        // [Phase13・次アクションitem3] 参加者一覧のバッジ表示(ポーリング)。
        badgesStore.start(scope, tokenServerUrl, roomId) { authManager.fetchIdToken() }
        // [パンくず表示] 変化頻度が低いため入室時に1回だけ取得する
        // (badgesStore.startのようなポーリングはしない。PTTOrgContextStore参照)。
        orgContextStore.fetchOnce(scope, tokenServerUrl, roomId) { authManager.fetchIdToken() }
        connectionManager.connect(
            tokenServerUrl = tokenServerUrl,
            livekitUrl = livekitUrl,
            roomNameParam = roomId,
            idTokenProvider = { authManager.fetchIdToken() },
        )
        // [ルーム名の再取得] 保存済みルームからの再入室(/joinを経由しない)や、
        // 入室後にadmin-dashboard側で名前が変更された場合にも対応できるよう、
        // 入室のたびに最新値を取り直す(iOS版ContentView.enterRoom()・Web版
        // RoomView.vueのenter()が毎回fetchAutoRecordingを呼ぶのと同じ方針)。
        // 新規参加(joinRoom())側で既に取得済みの場合も再取得するが、失敗しても
        // 既存の値を上書きしない(nullを返した場合はcurrentRoomNameを変更しない)。
        scope.launch {
            val idToken = try { authManager.fetchIdToken() } catch (e: Exception) { null }
            if (idToken == null || activeRoomId != roomId) return@launch
            roomManager.fetchRoomName(tokenServerUrl, idToken, roomId)?.let { fetched ->
                fetched.name?.let { currentRoomName = it }
            }
        }
    }

    fun enterRoom(roomId: String) {
        Log.d(TAG, "enterRoom: roomId=$roomId")
        banNotice = null
        activeRoomId = roomId
    }

    fun leaveRoom() {
        Log.d(TAG, "leaveRoom: activeRoomId=$activeRoomId")
        if (status !is ConnectionStatus.Disconnected) connectionManager.disconnect()
        chatStore.stop()
        banStore.stop()
        badgesStore.stop()
        orgContextStore.stop()
        activeRoomId = null
        currentInviteCode = null
        currentRoomName = null
        joinRoomId = ""
        joinInviteCode = ""
        chatInput = ""
        pendingAttachmentUri = null
    }

    // [BAN対応] 自分がBANされたことをリアルタイム検知したら、即座にルームから退出する。
    // BAN自体の強制力はLiveKit側の即時キック(サーバー)が担うため、ここは表示のための補助。
    LaunchedEffect(isBanned) {
        if (isBanned) {
            banNotice = banNoticeText
            leaveRoom()
        }
    }

    fun confirmBan(target: ParticipantInfo) {
        banTarget = null
        val roomId = activeRoomId ?: return
        scope.launch {
            try {
                val idToken = authManager.fetchIdToken()
                banStore.banParticipant(tokenServerUrl, idToken, roomId, target.identity)
            } catch (e: Exception) {
                // banStore.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    // [2026-08-04・次アクションitem4] Room owner向けバッジ付与。BANと異なり誤操作時の
    // 被害が小さい(取消可能な役割表示にすぎない)ため、確認ダイアログは挟まず即実行する。
    fun grantBadge(target: ParticipantInfo, badgeId: String) {
        val roomId = activeRoomId ?: return
        scope.launch {
            try {
                val idToken = authManager.fetchIdToken()
                badgesStore.grantBadge(tokenServerUrl, idToken, roomId, target.identity, badgeId)
            } catch (e: Exception) {
                // badgesStore.grantErrorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    fun revokeBadge(target: ParticipantInfo, badgeId: String) {
        val roomId = activeRoomId ?: return
        scope.launch {
            try {
                val idToken = authManager.fetchIdToken()
                badgesStore.revokeBadge(tokenServerUrl, idToken, roomId, target.identity, badgeId)
            } catch (e: Exception) {
                // badgesStore.grantErrorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    // [録音UI] 開始ボタンの確認ダイアログで「開始する」を選んだ際に呼ばれる。
    fun startRecording() {
        showRecordingStartConfirm = false
        val roomId = activeRoomId ?: return
        scope.launch {
            try {
                val idToken = authManager.fetchIdToken()
                recordingStore.startRecording(tokenServerUrl, idToken, roomId)
            } catch (e: Exception) {
                // recordingStore.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    fun stopRecording() {
        val roomId = activeRoomId ?: return
        scope.launch {
            try {
                val idToken = authManager.fetchIdToken()
                recordingStore.stopRecording(tokenServerUrl, idToken, roomId)
            } catch (e: Exception) {
                // recordingStore.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    // [Phase16] pendingAttachmentUriの送信・取消。Web版sendPendingFile/cancelPendingFileの移植。
    fun sendPendingAttachment() {
        val uri = pendingAttachmentUri ?: return
        val roomId = activeRoomId ?: return
        pendingAttachmentUri = null
        attachmentSending = true
        scope.launch {
            try {
                val idToken = authManager.fetchIdToken()
                chatStore.sendAttachment(tokenServerUrl, idToken, roomId, uri)
            } catch (e: Exception) {
                // chatStore.errorMessage に理由がセットされているのでUIには既に反映済み
            } finally {
                attachmentSending = false
            }
        }
    }

    fun cancelPendingAttachment() {
        pendingAttachmentUri = null
    }

    // [Phase16] ChatSectionへ渡す、tokenServerUrl/roomIdを束縛した閲覧URL発行関数
    // (Web版RoomView.vueがChatPanel.vueへgetAttachmentUrl/getThumbnailUrlを注入するのと同じ設計)。
    suspend fun resolveAttachmentUrl(messageId: String): String {
        val roomId = activeRoomId ?: throw IllegalStateException("not in a room")
        val idToken = authManager.fetchIdToken()
        return chatStore.getAttachmentUrl(tokenServerUrl, idToken, roomId, messageId)
    }

    suspend fun resolveThumbnailUrl(messageId: String): String {
        val roomId = activeRoomId ?: throw IllegalStateException("not in a room")
        val idToken = authManager.fetchIdToken()
        return chatStore.getThumbnailUrl(tokenServerUrl, idToken, roomId, messageId)
    }

    // [通報UI] 理由入力ダイアログで「送信する」を選んだ際に呼ばれる。
    // Web版のreportParticipant(window.promptの戻り値をtrimして空ならskip)と同じ挙動。
    fun submitReport(target: ParticipantInfo) {
        val reason = reportReasonText.trim()
        reportTarget = null
        reportReasonText = ""
        if (reason.isEmpty()) return
        val roomId = activeRoomId ?: return
        scope.launch {
            try {
                val idToken = authManager.fetchIdToken()
                reportStore.submitReport(tokenServerUrl, idToken, roomId, target.identity, reason)
            } catch (e: Exception) {
                // reportStore.errorMessage に理由がセットされているのでUIには既に反映済み
            }
        }
    }

    if (currentUser == null) {
        // [モバイルUI再編・2026-08-04] 未サインイン画面はヘッダー・タブを持たず、
        // AuthSectionのみを表示する(iOS版authSectionと同じ「タブを持たない」設計)。
        // ただし接続先(サーバー/LiveKit)は未サインインでも変更できる必要があるため、
        // iOS版の`.overlay(alignment: .topTrailing) { PTTSettingsIcon(...) }`と同じく
        // 画面右上に歯車アイコンだけ重ねて残す。
        Box(Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                AuthSection(
                    errorMessage = authError,
                    onSignIn = onRequestGoogleSignIn,
                    onSignInAsGuest = { scope.launch { authManager.signInAsGuest() } },
                )
            }
            Box(Modifier.align(Alignment.TopEnd).padding(16.dp)) {
                SettingsIcon(settingsStore = settingsStore)
            }
        }
    } else {
        // [見出し・アイコンの表示名切り替え・再訂正] Roomが組織(orgId)に紐づく場合、
        // 最下層のノード名を優先して使う(同名の組織が複数の支社・現場を持つ場合、
        // 最上位の組織名だけでは区別がつかないため)。ノード未割り当ての場合は
        // 組織名、無所属Roomはルーム名を使う。Web版RoomView.vueのdisplayNameに相当。
        val displayName = orgContext.breadcrumb.lastOrNull()?.name
            ?: orgContext.orgName
            ?: currentRoomName

        Column(Modifier.fillMaxSize()) {
            // [モバイルUI再編・2026-08-04] 接続状態・ルーム名・録音中バナーは
            // 入室中のみ、4タブ共通のヘッダー領域に固定表示する(iOS版bodyの
            // `if activeRoomId != nil && selectedTab != .settings { header(); ... }`
            // の移植)。設定タブはプロフィール/接続設定/録音操作などルームに
            // 紐づかない項目が中心のため、選択中はこのヘッダーを表示しない
            // (iOS版3訂の移植)。
            if (activeRoomId != null && selectedTab != RootTab.SETTINGS) {
                Column(Modifier.padding(16.dp)) {
                    HeaderRow(
                        // [表示名の優先順位] Web版App.vueのheaderDisplayNameと同じ: ルーム内で
                        // 変更したニックネーム(myDisplayName)があればそれを優先し、無ければ
                        // Firebase Authの値(authManager.displayName)を使う。
                        currentUserName = myDisplayName ?: authManager.displayName,
                        photoUrl = currentUser?.photoUrl?.toString(),
                        isSignedIn = true,
                        status = status,
                        roomName = displayName,
                        settingsStore = settingsStore,
                        onSignOut = { leaveRoom(); authManager.signOut() },
                    )
                    displayName?.let { name ->
                        Text(
                            name,
                            fontFamily = Mono,
                            fontSize = 15.sp,
                            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                            color = PTTColors.Text,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(4.dp))
                    }
                    OrgBreadcrumbRow(orgContext)
                    RecordingBanner(isRecording = isRecording, recordingStartedAt = recordingStartedAt)
                }
            }

            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (selectedTab) {
                    RootTab.TALK -> TalkTabContent(
                        activeRoomId = activeRoomId,
                        banNotice = banNotice,
                        isWorking = roomWorking,
                        errorMessage = roomError,
                        savedRooms = savedRooms,
                        joinRoomId = joinRoomId,
                        onJoinRoomIdChange = { joinRoomId = it },
                        joinInviteCode = joinInviteCode,
                        onJoinInviteCodeChange = { joinInviteCode = it },
                        onJoinRoom = {
                            val roomId = joinRoomId.trim()
                            val inviteCode = joinInviteCode.trim()
                            if (roomId.isNotEmpty() && inviteCode.isNotEmpty()) {
                                roomManager.clearError()
                                scope.launch {
                                    try {
                                        val idToken = authManager.fetchIdToken()
                                        val joined = roomManager.joinRoom(tokenServerUrl, idToken, roomId, inviteCode)
                                        // 参加者自身が入力したコードをそのまま保持する
                                        // (以前はnullで潰していたため招待コード欄が表示されなかった)。
                                        currentInviteCode = inviteCode
                                        currentRoomName = joined.name
                                        // [表示仕様・2026-08-06] ルーム名未設定時の汎用ラベルへの
                                        // フォールバックは廃止。未設定の場合はnameをnullのまま保存し、
                                        // 一覧側(SavedRoomRow)でroomIdを表示する。開始/終了時刻も
                                        // 履歴に保存しておき、一覧の下段に出す(Web版・iOS版と同じ方針)。
                                        savedRoomsStore.upsert(roomId, joined.name, inviteCode, joined.schedule)
                                        enterRoom(roomId)
                                    } catch (e: Exception) {
                                        // roomManager.lastErrorMessage に理由がセットされている
                                    }
                                }
                            }
                        },
                        onRejoinSaved = { saved ->
                            currentInviteCode = saved.inviteCode
                            // /join を経由しないため、ルーム名は未取得の状態からスタートする
                            // (Web版roomStore.reenter()と同じ方針。取り直す仕組みは持たない)。
                            currentRoomName = null
                            enterRoom(saved.roomId)
                        },
                        onRemoveSaved = { savedRoomsStore.remove(it) },
                        isConnected = status is ConnectionStatus.Connected,
                        isSending = isSending,
                        someoneElseTalking = someoneElseIsTalking,
                        talkerName = currentTalkerName,
                        onStartTalk = { connectionManager.startTalking() },
                        onStopTalk = { connectionManager.stopTalking() },
                        onLeaveRoom = { leaveRoom() },
                    )

                    RootTab.MEMBERS -> MembersTabContent(
                        activeRoomId = activeRoomId,
                        participants = participants,
                        myUid = currentUser?.uid,
                        // [Phase12・十五訂] role分岐はPTTRoomPermissions.ktに集約(token-server/lib/permissions.jsとCI同期)。
                        canBan = PTTRoomPermissions.canManageRoom(myRole),
                        onRequestBan = { banTarget = it },
                        onRequestReport = { reportTarget = it; reportReasonText = "" },
                        reportError = reportError,
                        // [Phase13・次アクションitem3] uid -> 最優先1件のバッジ。
                        topBadges = badgesByUid.mapValues { (_, entry) -> entry.topBadge },
                        // [2026-08-04・次アクションitem4] Room owner向けバッジ付与/剥奪。
                        // grantableBadgesがnullの間(=ownerでない、または未取得)は何も出さない。
                        allBadges = badgesByUid.mapValues { (_, entry) -> entry.badges },
                        grantableBadges = grantableBadges,
                        isGrantingBadge = badgeGranting,
                        badgeGrantError = badgeGrantError,
                        onGrantBadge = { target, badgeId -> grantBadge(target, badgeId) },
                        onRevokeBadge = { target, badgeId -> revokeBadge(target, badgeId) },
                    )

                    RootTab.CHAT -> ChatTabContent(
                        activeRoomId = activeRoomId,
                        messages = chatMessages,
                        myUid = currentUser?.uid,
                        input = chatInput,
                        onInputChange = { chatInput = it },
                        errorMessage = chatError,
                        onSend = {
                            val roomId = activeRoomId
                            val text = chatInput
                            if (roomId != null && text.isNotBlank()) {
                                chatInput = ""
                                scope.launch {
                                    try {
                                        val idToken = authManager.fetchIdToken()
                                        chatStore.sendMessage(tokenServerUrl, idToken, roomId, text)
                                    } catch (e: Exception) {
                                        chatInput = text
                                    }
                                }
                            }
                        },
                        pendingAttachmentName = pendingAttachmentName,
                        attachmentSending = attachmentSending,
                        onPickAttachment = { launchAttachmentPicker() },
                        onSendPendingAttachment = { sendPendingAttachment() },
                        onCancelPendingAttachment = { cancelPendingAttachment() },
                        getAttachmentUrl = { messageId -> resolveAttachmentUrl(messageId) },
                        getThumbnailUrl = { messageId -> resolveThumbnailUrl(messageId) },
                    )

                    RootTab.SETTINGS -> SettingsTabContent(
                        displayName = myDisplayName ?: authManager.displayName,
                        photoUrl = currentUser?.photoUrl?.toString(),
                        isGuestAccount = currentUser?.isAnonymous == true,
                        onSignOut = { leaveRoom(); authManager.signOut() },
                        settingsStore = settingsStore,
                        activeRoomId = activeRoomId,
                        isGuestInRoom = myRole == "guest",
                        guestDisplayName = myDisplayName,
                        nicknameUpdating = nicknameUpdating,
                        nicknameError = nicknameError,
                        onUpdateNickname = { name ->
                            val roomId = activeRoomId ?: return@SettingsTabContent
                            scope.launch {
                                try {
                                    val idToken = authManager.fetchIdToken()
                                    banStore.updateNickname(tokenServerUrl, idToken, roomId, name)
                                } catch (e: Exception) {
                                    // banStore.nicknameErrorMessage に理由がセットされているのでUIには既に反映済み
                                }
                            }
                        },
                        // [Phase12・十五訂] role分岐はPTTRoomPermissions.ktに集約(token-server/lib/permissions.jsとCI同期)。
                        canControlRecording = PTTRoomPermissions.canManageRoom(myRole),
                        isRecording = isRecording,
                        recordingStarting = recordingStarting,
                        recordingStopping = recordingStopping,
                        recordingError = recordingError,
                        onRequestStartRecording = { showRecordingStartConfirm = true },
                        onStopRecording = { stopRecording() },
                    )
                }
            }

            // [2026-08-04] 開発者向けログ表示(LogSection)を非表示化。
            // ログの収集自体(PTTConnectionManager.logLines / _logLines.update)は維持しており、
            // 表示のみをコメントアウトしている。再表示が必要な場合はこの行を戻すこと(iOS ContentView.swiftの
            // logSectionコメントアウトと同じ方針)。
            // LogSection(logLines)

            RootTabBar(selectedTab = selectedTab, onSelect = { setSelectedTab(it) })
        }
    }

    // [BAN対応] BANボタン押下時の確認ダイアログ
    banTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { banTarget = null },
            title = { Text(stringResource(R.string.room_ban_confirm_title), fontFamily = Mono) },
            text = {
                Text(
                    stringResource(R.string.room_ban_confirm_description, target.name),
                    fontFamily = Mono,
                )
            },
            confirmButton = {
                Button(
                    onClick = { confirmBan(target) },
                    colors = ButtonDefaults.buttonColors(containerColor = PTTColors.Danger),
                ) {
                    Text(stringResource(R.string.room_ban_confirm_label), fontFamily = Mono)
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { banTarget = null }) {
                    Text(stringResource(R.string.common_cancel), fontFamily = Mono)
                }
            },
        )
    }

    // [録音UI] 開始ボタン押下時の確認ダイアログ。Web版RecordingBar.vueの
    // ConfirmDialog(showStartConfirm)・iOS版のalertに相当。録音中であることは
    // 全参加者に開示される旨をここで明示してから開始する。
    if (showRecordingStartConfirm) {
        AlertDialog(
            onDismissRequest = { showRecordingStartConfirm = false },
            title = { Text(stringResource(R.string.recording_start_confirm_title), fontFamily = Mono) },
            text = { Text(stringResource(R.string.recording_start_confirm_description), fontFamily = Mono) },
            confirmButton = {
                Button(
                    onClick = { startRecording() },
                    colors = ButtonDefaults.buttonColors(containerColor = PTTColors.Accent),
                ) {
                    Text(stringResource(R.string.recording_start_confirm_label), fontFamily = Mono)
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { showRecordingStartConfirm = false }) {
                    Text(stringResource(R.string.common_cancel), fontFamily = Mono)
                }
            },
        )
    }

    // [通報UI] Web版の`window.prompt(...)`・iOS版のtextField付きalertに相当。
    // 理由が空のまま送信した場合は何もしない(submitReport内でtrim済みの空文字を判定)。
    reportTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { reportTarget = null; reportReasonText = "" },
            title = { Text(stringResource(R.string.report_dialog_title), fontFamily = Mono) },
            text = {
                Column {
                    Text(stringResource(R.string.report_dialog_description, target.name), fontFamily = Mono)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = reportReasonText,
                        onValueChange = { reportReasonText = it },
                        placeholder = { Text(stringResource(R.string.report_reason_placeholder), fontFamily = Mono, fontSize = 12.sp) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { submitReport(target) },
                    enabled = reportReasonText.isNotBlank() && !reportSubmitting,
                    colors = ButtonDefaults.buttonColors(containerColor = PTTColors.Accent),
                ) {
                    Text(stringResource(R.string.report_submit_label), fontFamily = Mono)
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { reportTarget = null; reportReasonText = "" }) {
                    Text(stringResource(R.string.common_cancel), fontFamily = Mono)
                }
            },
        )
    }
}

// MARK: - Tabs (4タブ構成: 通話/参加者/チャット/設定)
// [モバイルUI再編・2026-08-04] iOS版ContentView.swiftの同名セクション(customTabBar・
// talkTabContent・membersTabContent・chatTabContent・settingsTabContent)の移植。

/**
 * カスタムタブバー本体。iOS版customTabBarの移植(こちらはComposeの標準
 * NavigationBarで十分色を制御できるため、iOS版のような自前描画への切り替え理由
 * (Liquid Glassのハイライトフラッシュ回避)はないが、見た目・挙動を揃えるため
 * 同じくアイコン+ラベル+選択時カプセルハイライトの自前実装にしている)。
 * [不具合修正・2026-08-05] 当初はアイコンを絵文字(🎙️👥💬⚙️)で代替していたが、
 * Android標準の絵文字フォントはカラー(COLR/CPAL)グリフのため、選択中/非選択中の
 * 色分け(Text(color=...))が反映されず、他のUI(PTTColors.Muted/Accentの単色トーン)
 * から浮いて見える不具合があった。ic_person.xml・ic_settings_gear.xmlと同じ方針
 * (material-icons-extendedへの依存を増やさない)で、単色のvector drawable
 * (ic_tab_mic/ic_tab_people/ic_tab_chat、設定タブは既存のic_settings_gearを流用)を
 * 新設し、Icon(tint=...)で明示的に色指定する形へ差し替えた。
 * [不具合修正・2026-08-05(2)] iOS版は`.glassEffect(..., in: Capsule())`で完全な
 * カプセル形にしているが、こちらは固定角丸(24dp)のため高さによっては完全な
 * カプセルにならなかった。`RoundedCornerShape(percent = 50)`(高さに応じて
 * 動的に丸める指定)に変更し、形状をカプセルに揃えた。半透明+ぼかし
 * (Liquid Glass)自体は新規ライブラリ(Haze等)の追加が前提になるため、
 * 今回のスコープには含めていない(ユーザー確認済み、2026-08-05)。
 */
@Composable
private fun RootTabBar(selectedTab: RootTab, onSelect: (RootTab) -> Unit) {
    val capsuleShape = androidx.compose.foundation.shape.RoundedCornerShape(percent = 50)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 8.dp)
            .background(PTTColors.Panel, shape = capsuleShape)
            .border(BorderStroke(1.dp, PTTColors.Line), capsuleShape)
            .padding(6.dp),
    ) {
        TabBarButton(RootTab.TALK, R.drawable.ic_tab_mic, stringResource(R.string.tab_talk), selectedTab, onSelect)
        TabBarButton(RootTab.MEMBERS, R.drawable.ic_tab_people, stringResource(R.string.tab_members), selectedTab, onSelect)
        TabBarButton(RootTab.CHAT, R.drawable.ic_tab_chat, stringResource(R.string.tab_chat), selectedTab, onSelect)
        TabBarButton(RootTab.SETTINGS, R.drawable.ic_settings_gear, stringResource(R.string.tab_settings), selectedTab, onSelect)
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabBarButton(
    tab: RootTab,
    @androidx.annotation.DrawableRes iconRes: Int,
    label: String,
    selectedTab: RootTab,
    onSelect: (RootTab) -> Unit,
) {
    val isSelected = tab == selectedTab
    val tint = if (isSelected) PTTColors.Accent else PTTColors.Muted
    // [不具合修正・2026-08-05(2)] iOS版`.animation(.easeOut(duration: 0.15), value: isSelected)`
    // の移植。従来は選択ハイライト(カプセル背景)の表示/非表示が瞬時に切り替わっていたが、
    // 透明色からPTTColors.AccentDimへ150msでフェードするアニメーションを追加した。
    val highlightColor by animateColorAsState(
        targetValue = if (isSelected) PTTColors.AccentDim.copy(alpha = 0.55f) else Color.Transparent,
        animationSpec = tween(durationMillis = 150, easing = LinearOutSlowInEasing),
        label = "tabHighlight",
    )
    Column(
        Modifier
            .weight(1f)
            .clip(androidx.compose.foundation.shape.CircleShape)
            .background(highlightColor)
            .clickable { onSelect(tab) }
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            painter = painterResource(iconRes),
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            label,
            fontFamily = Mono,
            fontSize = 10.sp,
            fontWeight = androidx.compose.ui.text.font.FontWeight.Medium,
            color = tint,
        )
    }
}

/**
 * 通話タブ。未入室=ルーム選択画面、入室中=PTTボタン+退出ボタンを表示する
 * (iOS版talkTabContentの移植)。「入室後は通話ボタン＋ルーム退出ボタンも表示」
 * という要件に合わせ、退出ボタンはこのタブの下部に据える。
 */
@Composable
private fun TalkTabContent(
    activeRoomId: String?,
    banNotice: String?,
    isWorking: Boolean,
    errorMessage: String?,
    savedRooms: List<SavedRoom>,
    joinRoomId: String,
    onJoinRoomIdChange: (String) -> Unit,
    joinInviteCode: String,
    onJoinInviteCodeChange: (String) -> Unit,
    onJoinRoom: () -> Unit,
    onRejoinSaved: (SavedRoom) -> Unit,
    onRemoveSaved: (String) -> Unit,
    isConnected: Boolean,
    isSending: Boolean,
    someoneElseTalking: Boolean,
    talkerName: String,
    onStartTalk: () -> Unit,
    onStopTalk: () -> Unit,
    onLeaveRoom: () -> Unit,
) {
    if (activeRoomId != null) {
        Column(Modifier.fillMaxSize()) {
            Spacer(Modifier.weight(1f))
            TalkArea(
                isConnected = isConnected,
                isSending = isSending,
                someoneElseTalking = someoneElseTalking,
                talkerName = talkerName,
                onStart = onStartTalk,
                onStop = onStopTalk,
            )
            Spacer(Modifier.weight(1f))
            Button(
                onClick = onLeaveRoom,
                modifier = Modifier.fillMaxWidth().padding(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = PTTColors.Danger),
            ) {
                Text(stringResource(R.string.room_leave_room), fontFamily = Mono)
            }
        }
    } else {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            banNotice?.let {
                Text(it, fontFamily = Mono, fontSize = 12.sp, color = PTTColors.Danger)
                Spacer(Modifier.height(8.dp))
            }
            RoomSelectionSection(
                isWorking = isWorking,
                errorMessage = errorMessage,
                savedRooms = savedRooms,
                joinRoomId = joinRoomId,
                onJoinRoomIdChange = onJoinRoomIdChange,
                joinInviteCode = joinInviteCode,
                onJoinInviteCodeChange = onJoinInviteCodeChange,
                onJoinRoom = onJoinRoom,
                onRejoinSaved = onRejoinSaved,
                onRemoveSaved = onRemoveSaved,
            )
        }
    }
}

/** 参加者タブ。未入室中はそもそも参加者情報が存在しないため案内文のみを表示する(iOS版membersTabContentの移植)。 */
@Composable
private fun MembersTabContent(
    activeRoomId: String?,
    participants: Map<String, ParticipantInfo>,
    myUid: String?,
    canBan: Boolean,
    onRequestBan: (ParticipantInfo) -> Unit,
    onRequestReport: (ParticipantInfo) -> Unit,
    reportError: String?,
    topBadges: Map<String, AssignedBadge?>,
    allBadges: Map<String, List<AssignedBadge>>,
    grantableBadges: List<co.ubunifu.pttandroid.model.GrantableBadge>?,
    isGrantingBadge: Boolean,
    badgeGrantError: String?,
    onGrantBadge: (ParticipantInfo, String) -> Unit,
    onRevokeBadge: (ParticipantInfo, String) -> Unit,
) {
    if (activeRoomId != null) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            ParticipantsSection(
                participants = participants,
                myUid = myUid,
                canBan = canBan,
                onRequestBan = onRequestBan,
                onRequestReport = onRequestReport,
                reportError = reportError,
                topBadges = topBadges,
                allBadges = allBadges,
                grantableBadges = grantableBadges,
                isGrantingBadge = isGrantingBadge,
                badgeGrantError = badgeGrantError,
                onGrantBadge = onGrantBadge,
                onRevokeBadge = onRevokeBadge,
            )
        }
    } else {
        EmptyTabPlaceholder(stringResource(R.string.tab_members_empty))
    }
}

/** チャットタブ。未入室中は案内文のみを表示する(iOS版chatTabContentの移植)。 */
@Composable
private fun ChatTabContent(
    activeRoomId: String?,
    messages: List<co.ubunifu.pttandroid.model.ChatMessage>,
    myUid: String?,
    input: String,
    onInputChange: (String) -> Unit,
    errorMessage: String?,
    onSend: () -> Unit,
    pendingAttachmentName: String?,
    attachmentSending: Boolean,
    onPickAttachment: () -> Unit,
    onSendPendingAttachment: () -> Unit,
    onCancelPendingAttachment: () -> Unit,
    getAttachmentUrl: suspend (String) -> String,
    getThumbnailUrl: suspend (String) -> String,
) {
    if (activeRoomId != null) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            ChatSection(
                messages = messages,
                myUid = myUid,
                input = input,
                onInputChange = onInputChange,
                errorMessage = errorMessage,
                onSend = onSend,
                pendingAttachmentName = pendingAttachmentName,
                attachmentSending = attachmentSending,
                onPickAttachment = onPickAttachment,
                onSendPendingAttachment = onSendPendingAttachment,
                onCancelPendingAttachment = onCancelPendingAttachment,
                getAttachmentUrl = getAttachmentUrl,
                getThumbnailUrl = getThumbnailUrl,
            )
        }
    } else {
        EmptyTabPlaceholder(stringResource(R.string.tab_chat_empty))
    }
}

/** 参加者/チャットタブを未入室中に開いた場合の空状態表示(iOS版emptyTabPlaceholderの移植)。 */
@Composable
private fun EmptyTabPlaceholder(message: String) {
    Box(Modifier.fillMaxSize().padding(40.dp), contentAlignment = Alignment.Center) {
        Text(
            message,
            fontFamily = Mono,
            fontSize = 12.sp,
            color = PTTColors.Muted,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

/**
 * 設定タブ(旧: ヘッダー常時表示のプロフィールアイコン・歯車アイコン)。
 * プロフィール(旧ヘッダーのLoginStatusIcon相当)・接続設定(旧ヘッダーのSettingsIcon相当)を
 * 新たに集約し、入室中のみ意味を持つ操作(ゲストのニックネーム変更・録音操作)は
 * それに続けて表示する(iOS版settingsTabContentの移植)。
 */
@Composable
private fun SettingsTabContent(
    displayName: String?,
    photoUrl: String?,
    isGuestAccount: Boolean,
    onSignOut: () -> Unit,
    settingsStore: PTTSettingsStore,
    activeRoomId: String?,
    isGuestInRoom: Boolean,
    guestDisplayName: String?,
    nicknameUpdating: Boolean,
    nicknameError: String?,
    onUpdateNickname: (String) -> Unit,
    canControlRecording: Boolean,
    isRecording: Boolean,
    recordingStarting: Boolean,
    recordingStopping: Boolean,
    recordingError: String?,
    onRequestStartRecording: () -> Unit,
    onStopRecording: () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Text(
            stringResource(R.string.settings_title),
            fontFamily = Mono,
            fontSize = 11.sp,
            color = PTTColors.Muted,
            modifier = Modifier.fillMaxWidth().padding(14.dp),
        )
        ProfileRow(displayName = displayName, photoUrl = photoUrl, isGuestAccount = isGuestAccount, onSignOut = onSignOut)
        SettingsDivider()
        ConnectionSettingsRow(settingsStore)
        if (activeRoomId != null) {
            SettingsDivider()
            if (isGuestInRoom) {
                Column(Modifier.padding(top = 10.dp, start = 14.dp, end = 14.dp)) {
                    GuestStatusBar(
                        isGuest = true,
                        displayName = guestDisplayName,
                        updating = nicknameUpdating,
                        errorMessage = nicknameError,
                        onUpdateNickname = onUpdateNickname,
                    )
                }
            }
            if (canControlRecording) {
                RecordingControls(
                    isRecording = isRecording,
                    starting = recordingStarting,
                    stopping = recordingStopping,
                    errorMessage = recordingError,
                    onRequestStart = onRequestStartRecording,
                    onStop = onStopRecording,
                )
            }
        }
    }
}

/** 設定タブの区切り線。iOS版`Divider().overlay(Color.pttLine).padding(.horizontal, 14)`の移植。 */
@Composable
private fun SettingsDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp)
            .height(1.dp)
            .background(PTTColors.Line),
    )
}

/**
 * プロフィール行(アバター・表示名・ログイン種別・サインアウト)。
 * 従来ヘッダーの丸アイコン+メニューだった導線を、設定タブ内の常時表示行に
 * 置き換えた(iOS版profileSectionの移植)。
 */
@Composable
private fun ProfileRow(
    displayName: String?,
    photoUrl: String?,
    isGuestAccount: Boolean,
    onSignOut: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(PTTColors.Panel)
                .border(BorderStroke(1.dp, PTTColors.Line), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            ProfileAvatar(photoUrl, size = 40.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.room_nickname_unset),
                fontFamily = Mono,
                fontSize = 13.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                color = PTTColors.Text,
            )
            Text(
                if (isGuestAccount) {
                    stringResource(R.string.settings_profile_signed_in_as_guest)
                } else {
                    stringResource(R.string.settings_profile_signed_in)
                },
                fontFamily = Mono,
                fontSize = 11.sp,
                color = PTTColors.Muted,
            )
        }
        Text(
            stringResource(R.string.header_sign_out),
            fontFamily = Mono,
            fontSize = 12.sp,
            color = PTTColors.Danger,
            modifier = Modifier
                .padding(start = 8.dp)
                .pointerInput(Unit) { detectTapGestures(onTap = { onSignOut() }) },
        )
    }
}

/**
 * [不具合修正・2026-08-04] 従来はここに固定文言(header_app_name)+
 * ConnectionStatusIcon(接続状態を頭文字1文字で表す丸アイコン)を表示していたが、
 * ユーザー指摘により「アプリ名の静的表示」「アイコンだけでは何の状態か分かりにくい」
 * の2点を解消するため、組織/ルーム名(左、未設定時はアプリ名にフォールバック)と
 * 接続状態のドット+テキスト(右)を直接ヘッダーに並べる形へ変更した(Web版
 * AppHeader.vue・iOS版ContentView.swift 6訂の移植)。ドット色・短縮文言は
 * 従来StatusRowが持っていたstatusColor/statusTextの考え方を踏襲しつつ、
 * ルーム名の重複表示を避けるためroom=部分を含まない短縮文言
 * (status_header_connected/reconnecting)を新設して使う。これに伴い、
 * この下で別途表示していたStatusRow(room=付き)は廃止した。
 */
@Composable
private fun HeaderRow(
    currentUserName: String?,
    photoUrl: String?,
    isSignedIn: Boolean,
    status: ConnectionStatus,
    roomName: String?,
    settingsStore: PTTSettingsStore,
    onSignOut: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            roomName ?: stringResource(R.string.header_app_name),
            fontFamily = Mono,
            fontSize = 11.sp,
            color = PTTColors.Muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        Spacer(Modifier.width(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            HeaderStatusIndicator(status)
            Spacer(Modifier.width(8.dp))
            SettingsIcon(settingsStore = settingsStore)
            Spacer(Modifier.width(8.dp))
            LoginStatusIcon(
                photoUrl = photoUrl,
                displayName = currentUserName,
                isSignedIn = isSignedIn,
                onSignOut = onSignOut,
            )
        }
    }
    Spacer(Modifier.height(12.dp))
}

/**
 * ヘッダー右側の接続状態表示(ドット+短縮テキスト)。ルーム名は同ヘッダー左側で
 * 既に表示されているため、ここではroom=部分を含まない短縮文言を使う
 * (詳細はHeaderRowのコメント参照)。
 */
@Composable
private fun HeaderStatusIndicator(status: ConnectionStatus) {
    val (color, text) = when (status) {
        is ConnectionStatus.Disconnected -> PTTColors.Muted to stringResource(R.string.status_disconnected)
        is ConnectionStatus.Connecting -> PTTColors.Muted to stringResource(R.string.status_connecting)
        is ConnectionStatus.Connected -> PTTColors.Live to stringResource(R.string.status_header_connected)
        is ConnectionStatus.Reconnecting -> PTTColors.Warning to stringResource(R.string.status_header_reconnecting)
        is ConnectionStatus.Error -> PTTColors.Danger to stringResource(R.string.status_error, status.message)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(7.dp)
                .clip(CircleShape)
        ) {
            androidx.compose.foundation.Canvas(modifier = Modifier.size(7.dp)) {
                drawCircle(color = color)
            }
        }
        Spacer(Modifier.width(6.dp))
        Text(text, fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted)
    }
}

@Composable
private fun AuthSection(
    errorMessage: String?,
    onSignIn: () -> Unit,
    onSignInAsGuest: () -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // [モバイルUI再編・2026-08-04] 「接続先: ...」の控えめテキストはここに置いていたが、
        // iOS版authSection(グラスカード1枚構成)に合わせてカード内からは削除した。
        // 接続先の確認・変更手段は画面右上の歯車アイコン(SettingsIcon、呼び出し元の
        // PTTApp本体側でoverlay表示)に一本化する(iOS版のPTTSettingsIcon overlayと同じ)。
        Button(
            onClick = onSignIn,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = PTTColors.Accent),
        ) {
            Text(stringResource(R.string.auth_sign_in_with_google), fontFamily = Mono)
        }
        // [Phase10: Guestロール] 登録不要で入室できる導線。サーバー側(routes/rooms.js)が
        // Firebase匿名認証由来かどうかを見てrole:'guest'を割り当てる(Web版AuthView.vueと同じ)。
        OutlinedButton(onClick = onSignInAsGuest, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.auth_sign_in_as_guest), fontFamily = Mono)
        }
        Text(stringResource(R.string.auth_guest_hint), fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted)
        errorMessage?.let { Text(it, color = PTTColors.Danger, fontFamily = Mono, fontSize = 11.sp) }
    }
}

/**
 * [組織階層内の祖先パンくず表示] Web版RoomView.vueの`<OrgBreadcrumb>`・
 * iOS版orgBreadcrumbRowに相当。
 * 最下層のノード名は見出し(displayName)側で既に表示されているため、ここでは
 * 「組織名 › 祖先ノード…」という、最下層を除いた祖先経路のみを表示する。
 * breadcrumbが空(Room=組織直下でノード未割り当て)の場合、見出し側がorgNameを
 * 表示するため、ここでは何も表示しない(無所属Roomの場合と同じ「無ければ出さない」方針)。
 */
@Composable
private fun OrgBreadcrumbRow(orgContext: OrgContext) {
    val orgName = orgContext.orgName ?: return
    if (orgContext.breadcrumb.isEmpty()) return
    val ancestorNodes = orgContext.breadcrumb.dropLast(1)
    val text = (listOf(orgName) + ancestorNodes.map { it.name }).joinToString(" › ")
    Text(text, fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted)
    Spacer(Modifier.height(4.dp))
}

/**
 * [Phase10: Guestロール 5.1]
 * Web版(GuestStatusBar.vue)の移植。「自分自身がGuestとして参加していること」の表示と、
 * ニックネーム変更を担う。このコンポーネント自体はfirestore.rulesの制約により
 * 自分自身のmembersドキュメントしか読めないため、他参加者がGuestかどうかの判定は
 * 持たない(ここでは自分自身の状態のみを扱う)。
 *
 * [5.4「他参加者のGuest判定手段の欠如」について] 上記の制約は今も変わらないが、
 * 別経路(Phase13のバッジ表示、OrgBreadcrumbRow付近のtopBadges参照)で、Guestには
 * 常に「Guest」役割バッジ(🔰)が合成され、GET /:roomId/badges 経由でroom
 * メンバーなら誰でも参照できるようになった(token-server/lib/badges.js の
 * GUEST_ROLE_BADGE参照)。結果として、参加者一覧のバッジアイコン表示が
 * 副次的に「他参加者のGuest判定手段」を提供しており、5.4の懸念は実質的に
 * 解消されている(brushup-plan.md参照)。
 */
@Composable
private fun GuestStatusBar(
    isGuest: Boolean,
    displayName: String?,
    updating: Boolean,
    errorMessage: String?,
    onUpdateNickname: (String) -> Unit,
) {
    if (!isGuest) return

    var editing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(displayName ?: "") }
    LaunchedEffect(displayName) {
        if (!editing) draft = displayName ?: ""
    }

    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.room_guest_badge),
                fontFamily = Mono, fontSize = 10.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                color = PTTColors.Accent,
            )
            Spacer(Modifier.width(8.dp))
            if (!editing) {
                Text(
                    displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.room_nickname_unset),
                    fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.room_nickname_edit),
                    fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted,
                    modifier = Modifier.pointerInput(Unit) {
                        detectTapGestures(onTap = { draft = displayName ?: ""; editing = true })
                    },
                )
            }
        }
        if (editing) {
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = draft,
                onValueChange = { if (it.length <= 30) draft = it },
                placeholder = { Text(stringResource(R.string.room_nickname_placeholder), fontFamily = Mono, fontSize = 11.sp) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = {
                    val trimmed = draft.trim()
                    if (trimmed.isNotEmpty()) { onUpdateNickname(trimmed); editing = false }
                }),
            )
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    if (updating) stringResource(R.string.room_nickname_saving) else stringResource(R.string.room_nickname_save),
                    fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Accent,
                    modifier = Modifier.pointerInput(Unit) {
                        detectTapGestures(onTap = {
                            if (updating) return@detectTapGestures
                            val trimmed = draft.trim()
                            if (trimmed.isEmpty()) return@detectTapGestures
                            onUpdateNickname(trimmed)
                            editing = false
                        })
                    },
                )
                Text(
                    stringResource(R.string.common_cancel),
                    fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted,
                    modifier = Modifier.pointerInput(Unit) {
                        detectTapGestures(onTap = { editing = false })
                    },
                )
            }
        }
        errorMessage?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Danger)
        }
    }
}

/**
 * [モバイルUI再編・2026-08-04] 録音中であることの開示(赤バッジ+経過時間+同意文言)。
 * Web版RecordingBar.vue・iOS版recordingBannerの移植部分のうち、ロールに関わらず
 * 全参加者へ常時表示する必要がある部分(法的な同意の観点で必須)。タブ内に置くと
 * タブを切り替えた瞬間に開示が見えなくなってしまうため、タブ共通のヘッダー領域
 * (activeRoomId != null && selectedTab != SETTINGS の間)に置く前提で切り出した。
 * 開始/停止の操作ボタン自体はRecordingControls(設定タブ)側に分離した。
 */
@Composable
private fun RecordingBanner(isRecording: Boolean, recordingStartedAt: Long?) {
    if (!isRecording) return

    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(7.dp).clip(CircleShape)) {
                androidx.compose.foundation.Canvas(modifier = Modifier.size(7.dp)) {
                    drawCircle(color = PTTColors.Danger)
                }
            }
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(R.string.recording_active_label),
                fontFamily = Mono,
                fontSize = 11.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                color = PTTColors.Danger,
            )
            if (recordingStartedAt != null) {
                Spacer(Modifier.width(8.dp))
                // 1秒毎に再計算する経過時間表示。実際の録音中判定には使わない
                // (Web版RecordingBar.vue・iOS版のelapsedLabelと同じ役割)。
                var nowMillis by remember { mutableStateOf(System.currentTimeMillis()) }
                LaunchedEffect(recordingStartedAt) {
                    while (true) {
                        nowMillis = System.currentTimeMillis()
                        kotlinx.coroutines.delay(1000)
                    }
                }
                val totalSeconds = ((nowMillis - recordingStartedAt) / 1000).coerceAtLeast(0)
                Text(
                    "%02d:%02d".format(totalSeconds / 60, totalSeconds % 60),
                    fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted,
                )
            }
        }
        Text(
            stringResource(R.string.recording_consent_notice),
            fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted,
        )
    }
}

/**
 * [モバイルUI再編・2026-08-04] 録音の開始/停止ボタン本体。頻度の低い操作のため
 * 設定タブへ移設した(開示バナー自体はRecordingBannerとして常時表示を維持する。
 * iOS版recordingControlsSectionの移植)。owner/moderatorのみ表示する
 * (サーバー側でも権限を再チェックする。呼び出し元でcanControlを判定してから使う)。
 */
@Composable
private fun RecordingControls(
    isRecording: Boolean,
    starting: Boolean,
    stopping: Boolean,
    errorMessage: String?,
    onRequestStart: () -> Unit,
    onStop: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(14.dp)) {
        Text(
            stringResource(R.string.recording_controls_title),
            fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted,
        )
        Spacer(Modifier.height(8.dp))
        if (isRecording) {
            Text(
                if (stopping) stringResource(R.string.recording_stopping) else stringResource(R.string.recording_stop_button),
                fontFamily = Mono, fontSize = 11.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.Medium,
                color = PTTColors.Danger,
                modifier = Modifier.pointerInput(Unit) {
                    detectTapGestures(onTap = { if (!stopping) onStop() })
                },
            )
        } else {
            Text(
                if (starting) stringResource(R.string.recording_starting) else stringResource(R.string.recording_start_button),
                fontFamily = Mono, fontSize = 11.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.Medium,
                color = PTTColors.Accent,
                modifier = Modifier.pointerInput(Unit) {
                    detectTapGestures(onTap = { if (!starting) onRequestStart() })
                },
            )
        }
        errorMessage?.let {
            Text(it, fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Danger)
        }
    }
}

@Composable
private fun RoomSelectionSection(
    isWorking: Boolean,
    errorMessage: String?,
    savedRooms: List<SavedRoom>,
    joinRoomId: String,
    onJoinRoomIdChange: (String) -> Unit,
    joinInviteCode: String,
    onJoinInviteCodeChange: (String) -> Unit,
    onJoinRoom: () -> Unit,
    onRejoinSaved: (SavedRoom) -> Unit,
    onRemoveSaved: (String) -> Unit,
) {
    var isScannerOpen by remember { mutableStateOf(false) }
    if (isScannerOpen) {
        co.ubunifu.pttandroid.invite.QrScannerDialog(
            onDismiss = { isScannerOpen = false },
            onDecoded = { invite ->
                isScannerOpen = false
                onJoinRoomIdChange(invite.roomId)
                onJoinInviteCodeChange(invite.inviteCode)
            },
        )
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // [モバイルUI再編・2026-08-04] 「接続先: ...」の控えめテキストはここに置いていたが、
        // 設定タブに「接続設定(サーバー/LiveKit)」行として独立して常設されたため、
        // ここでの重複表示は不要になった。iOS版roomSelectionSectionも同様に
        // このテキストを持たない(接続先確認は設定タブのconnectionSettingsSectionに一本化)。

        // [ルーム作成のadmin-dashboard移管] ルーム作成はadmin-dashboard専用の
        // POST /admin/rooms(rooms:create権限)に一本化した。ptt-androidは常に
        // 既存ルームへの参加(招待コードでのjoin)のみを行う画面になっている
        // (Web版RoomSelectView.vueと同じ。brushup-plan.md参照)。これにより、
        // isAnonymous(Guest)によるボタン出し分けも不要になった。
        // [不具合修正・2026-08-04] 上記の案内文言(room_select_join_only_hint)自体は
        // iOS版ContentView.swift 6訂で削除された。ptt-androidもこれに合わせて
        // 表示を削除する(ユーザー指示)。文言リソース自体は他画面から参照されて
        // いないため未使用のまま残す(Web版が保持したまま残している未使用キーと同様の扱い)。

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                value = joinRoomId,
                onValueChange = onJoinRoomIdChange,
                label = { Text(stringResource(R.string.room_select_room_id_label), fontFamily = Mono, fontSize = 10.sp) },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            OutlinedTextField(
                value = joinInviteCode,
                onValueChange = onJoinInviteCodeChange,
                label = { Text(stringResource(R.string.room_select_invite_code_label), fontFamily = Mono, fontSize = 10.sp) },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
        }
        OutlinedButton(onClick = onJoinRoom, enabled = !isWorking, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.room_select_join_room), fontFamily = Mono)
        }
        OutlinedButton(onClick = { isScannerOpen = true }, modifier = Modifier.fillMaxWidth()) {
            Text("QRコードを読み取る", fontFamily = Mono)
        }

        errorMessage?.let { Text(it, color = PTTColors.Danger, fontFamily = Mono, fontSize = 11.sp) }

        if (savedRooms.isNotEmpty()) {
            Text(
                stringResource(R.string.room_select_recent_rooms),
                fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted,
                modifier = Modifier.fillMaxWidth(),
            )
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                savedRooms.forEach { saved ->
                    SavedRoomRow(saved, onRejoinSaved, onRemoveSaved)
                }
            }
        }
    }
}

@Composable
private fun SavedRoomRow(saved: SavedRoom, onOpen: (SavedRoom) -> Unit, onRemove: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(
            onClick = { onOpen(saved) },
            modifier = Modifier.weight(1f),
        ) {
            Column(horizontalAlignment = Alignment.Start) {
                // [表示仕様・2026-08-06] 上段: ルーム名があればルーム名、無ければroomId。
                Text(
                    saved.name ?: saved.roomId,
                    fontFamily = Mono, fontSize = 12.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                // 下段: 開始/終了時刻。どちらも未指定なら空欄。
                Text(
                    scheduleLabel(saved.schedule),
                    fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(
            stringResource(R.string.common_remove),
            fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted,
            modifier = Modifier.pointerInput(saved.roomId) {
                detectTapGestures(onTap = { onRemove(saved.roomId) })
            },
        )
    }
}

/**
 * [送話ロック連携] 自分以外が発話ロックを保持している間(someoneElseTalking)は
 * タップ判定を無効化し、「誰が話しているか」を表示する。実際のロック取得/延長/解放は
 * onStart/onStop経由でPTTConnectionManagerが担う(この関数自身はサーバーを呼ばない)。
 */
@Composable
private fun TalkArea(
    isConnected: Boolean,
    isSending: Boolean,
    someoneElseTalking: Boolean,
    talkerName: String,
    onStart: () -> Unit,
    onStop: () -> Unit,
) {
    val canTalk = isConnected && !someoneElseTalking
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .size(150.dp)
                .clip(CircleShape)
                .then(
                    if (canTalk) {
                        Modifier.pointerInput(Unit) {
                            detectTapGestures(
                                onPress = {
                                    onStart()
                                    tryAwaitRelease()
                                    onStop()
                                }
                            )
                        }
                    } else Modifier
                ),
            contentAlignment = Alignment.Center,
        ) {
            androidx.compose.foundation.Canvas(modifier = Modifier.size(150.dp)) {
                drawCircle(color = Color(0xFF10160F))
                drawCircle(
                    color = if (isSending) PTTColors.Accent else PTTColors.Line,
                    style = androidx.compose.ui.graphics.drawscope.Stroke(width = 4f),
                )
            }
            Text(
                text = when {
                    isSending -> stringResource(R.string.ptt_talking)
                    someoneElseTalking -> stringResource(R.string.ptt_talking_by_name, talkerName)
                    else -> stringResource(R.string.ptt_press_to_talk)
                },
                fontFamily = Mono,
                fontSize = 13.sp,
                color = if (isSending) PTTColors.Accent else PTTColors.Muted,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.padding(horizontal = 10.dp),
            )
        }
        Spacer(Modifier.height(14.dp))
        Text(
            stringResource(R.string.room_ptt_hint),
            fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted,
        )
    }
}

@Composable
private fun ParticipantsSection(
    participants: Map<String, ParticipantInfo>,
    myUid: String?,
    canBan: Boolean,
    onRequestBan: (ParticipantInfo) -> Unit,
    onRequestReport: (ParticipantInfo) -> Unit,
    reportError: String?,
    // [Phase13・次アクションitem3] uid -> 最優先1件のバッジ。取得中/未取得のuidは
    // マップに存在しない(Web版ParticipantList.vueのtopBadgesと同じ扱い)。
    topBadges: Map<String, AssignedBadge?>,
    // [2026-08-04・次アクションitem4] uid -> 現在付与されている全バッジ(剥奪ボタンの
    // 表示用)。Guestの役割バッジ(source == "guest-role")は剥奪操作の対象外のため、
    // 呼び出し側でsource == "grant"のもののみ表示に使う(ParticipantList.vueと同じ絞り込み)。
    allBadges: Map<String, List<AssignedBadge>>,
    // [2026-08-04・次アクションitem4] Room owner向けの付与できるバッジの選択肢。
    // ownerでない場合はnullが渡り、その場合は付与/剥奪UI自体を出さない
    // (サーバー側がowner以外にはnullを返すため、role判定をここで重複させない)。
    grantableBadges: List<co.ubunifu.pttandroid.model.GrantableBadge>?,
    isGrantingBadge: Boolean,
    badgeGrantError: String?,
    onGrantBadge: (ParticipantInfo, String) -> Unit,
    onRevokeBadge: (ParticipantInfo, String) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.participants_title), fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted)
        Spacer(Modifier.height(6.dp))
        if (participants.isEmpty()) {
            Text(stringResource(R.string.participants_none), fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                participants.values.sortedBy { it.name }.forEach { info ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // [Phase13・次アクションitem3] 最優先1件のバッジアイコン。
                        // Web版ParticipantList.vueの:title(ツールチップ)に相当する情報を
                        // contentDescription(スクリーンリーダー向け)として保持する。
                        topBadges[info.identity]?.let { badge ->
                            Text(
                                badge.icon,
                                fontFamily = Mono,
                                fontSize = 12.sp,
                                modifier = Modifier
                                    .padding(end = 4.dp)
                                    .semantics { contentDescription = badge.name },
                            )
                        }
                        Text(
                            info.name,
                            fontFamily = Mono,
                            fontSize = 11.sp,
                            color = if (!info.muted) PTTColors.Live else PTTColors.Muted,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        // [通報UI] 自分自身は対象外。誰でも通報できる(BANと異なりownerや
                        // moderator限定ではない)。
                        if (info.identity != myUid) {
                            Text(
                                stringResource(R.string.report_button),
                                fontFamily = Mono,
                                fontSize = 10.sp,
                                color = PTTColors.Muted,
                                modifier = Modifier
                                    .padding(start = 8.dp)
                                    .pointerInput(info.identity) {
                                        detectTapGestures(onTap = { onRequestReport(info) })
                                    },
                            )
                        }
                        // [BAN対応] owner/moderatorのみBANボタンを表示する
                        // (サーバー側でも権限を再チェックする)。自分自身は対象外。
                        if (canBan && info.identity != myUid) {
                            Text(
                                "BAN",
                                fontFamily = Mono,
                                fontSize = 10.sp,
                                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                                color = PTTColors.Danger,
                                modifier = Modifier
                                    .padding(start = 8.dp)
                                    .pointerInput(info.identity) {
                                        detectTapGestures(onTap = { onRequestBan(info) })
                                    },
                            )
                        }
                    }
                }
            }
        }
        reportError?.let {
            Spacer(Modifier.height(6.dp))
            Text(it, fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Danger)
        }

        // [2026-08-04・次アクションitem4] Room owner向けバッジ付与/剥奪。Web版
        // ParticipantList.vueの移植。grantableBadgesがnullの間は何も出さない。
        if (grantableBadges != null && participants.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            Text(
                stringResource(R.string.participants_badge_manage_title),
                fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted,
            )
            Spacer(Modifier.height(6.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                participants.values.sortedBy { it.name }.forEach { info ->
                    BadgeManageRow(
                        info = info,
                        assignedBadges = allBadges[info.identity].orEmpty().filter { it.source == "grant" },
                        grantableBadges = grantableBadges,
                        isGranting = isGrantingBadge,
                        onGrant = { badgeId -> onGrantBadge(info, badgeId) },
                        onRevoke = { badgeId -> onRevokeBadge(info, badgeId) },
                    )
                }
            }
            badgeGrantError?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Danger)
            }
        }
    }
}

/**
 * [2026-08-04・次アクションitem4] 1参加者分のバッジ付与/剥奪行。
 * 現在付与済みのバッジは剥奪ボタン付きで表示し、未付与の付与可能バッジは
 * DropdownMenu(Web版の<select>に相当)から選んで付与できるようにする。
 */
@Composable
private fun BadgeManageRow(
    info: ParticipantInfo,
    assignedBadges: List<AssignedBadge>,
    grantableBadges: List<co.ubunifu.pttandroid.model.GrantableBadge>,
    isGranting: Boolean,
    onGrant: (String) -> Unit,
    onRevoke: (String) -> Unit,
) {
    var menuExpanded by remember { mutableStateOf(false) }
    val owned = remember(assignedBadges) { assignedBadges.map { it.badgeId }.toSet() }
    val selectable = remember(grantableBadges, owned) { grantableBadges.filter { it.badgeId !in owned } }

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            info.name,
            fontFamily = Mono,
            fontSize = 10.sp,
            color = PTTColors.Muted,
            overflow = TextOverflow.Ellipsis,
            maxLines = 1,
            modifier = Modifier.widthIn(min = 64.dp),
        )
        // [注記] androidx.compose.foundation.layout.FlowRowはExperimentalLayoutApiの
        // opt-inが必要なため、依存関係を増やさずビルドの安定性を優先しColumnで
        // 縦積みにする(Web版のような折り返し表示ではないが、機能的には同等)。
        Column(
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.weight(1f).padding(start = 6.dp),
        ) {
            assignedBadges.forEach { badge ->
                Text(
                    "${badge.icon} ${badge.name} [${stringResource(R.string.participants_badge_revoke)}]",
                    fontFamily = Mono,
                    fontSize = 10.sp,
                    color = PTTColors.Danger,
                    modifier = Modifier
                        .pointerInput(badge.badgeId, isGranting) {
                            if (!isGranting) detectTapGestures(onTap = { onRevoke(badge.badgeId) })
                        },
                )
            }
            if (selectable.isNotEmpty()) {
                Box {
                    Text(
                        "+ ${stringResource(R.string.participants_badge_grant)}",
                        fontFamily = Mono,
                        fontSize = 10.sp,
                        color = PTTColors.Accent,
                        modifier = Modifier
                            .pointerInput(isGranting) {
                                if (!isGranting) detectTapGestures(onTap = { menuExpanded = true })
                            },
                    )
                    androidx.compose.material3.DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                    ) {
                        selectable.forEach { badge ->
                            androidx.compose.material3.DropdownMenuItem(
                                text = { Text("${badge.icon} ${badge.name}", fontFamily = Mono, fontSize = 12.sp) },
                                onClick = {
                                    menuExpanded = false
                                    onGrant(badge.badgeId)
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

// MARK: - チャットUI刷新(五十六訂のWeb版・五十七訂のiOS版に続くAndroid移植・LINEのトーク画面風)
//
// Web版(ptt-client/src/components/ChatPanel.vue)・iOS版(ContentView.swiftの
// chatSection/chatMessageRow)の移植。
//   - 左端にアバター、アバター上揃え・小さめフォントで名前
//   - テキストは枠付き・背景付きの吹き出し、コンテンツ右下(自分は左下)に時刻
//   - PDF/動画等はベクターアイコン＋ファイル名
//   - URLはハイパーリンク化(ClickableText + AnnotatedStringのURLアノテーション。
//     生のHTML化やWebViewには頼らないため、Web版がv-html不使用でXSSを避けている
//     のと同じ安全性を保てる)
//   - 自分の発言はLINE標準(右寄せ・アバター/名前非表示)
//   - 連続する同一送信者の発言はヘッダー(アバター+名前)を詰めて表示し、
//     日付が変わった箇所には区切りを挟む(5分以上間が空いたら出し直す)
//
// [五十六訂のIME誤送信バグについて] Web版で見つかった「日本語IMEの変換確定Enterが
// 誤って送信をトリガーする」バグは、Android版のOutlinedTextField(singleLine +
// ImeAction.Send)には当てはまらないと判断した。Web(ブラウザ)のkeydownイベントは
// 変換確定の押下も含めて生のキー入力を渡してくるが、AndroidのIME(Gboard等)は
// 変換候補の確定をアプリ側へ伝播させず、エディタアクション(ここではSend)は
// ユーザーが明示的に確定後のEnter/送信ボタンを押した時にのみ発火する設計のため。
// ただし本環境では実機・実IMEでの確認はできていないため、次アクションとして
// 実機確認を残す(iOS版が.onSubmitについて踏んだのと同じ留保)。

private const val CHAT_GROUP_WINDOW_MS = 5 * 60 * 1000L

private sealed class ChatListItem {
    abstract val key: String

    data class DateSeparator(override val key: String, val label: String) : ChatListItem()
    data class MessageItem(
        override val key: String,
        val message: co.ubunifu.pttandroid.model.ChatMessage,
        val showHeader: Boolean,
    ) : ChatListItem()
}

/** Web版`listItems`のcomputed・iOS版`chatListItems(_:)`と同じロジック:
 *  日付区切りを挟み、直前と同じ送信者かつ5分以内の連続投稿ではヘッダー
 *  (アバター+名前)を省略する。 */
private fun buildChatListItems(
    messages: List<co.ubunifu.pttandroid.model.ChatMessage>,
): List<ChatListItem> {
    val dateKeyFormat = java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.US)
    val dateLabelFormat = java.text.SimpleDateFormat(
        android.text.format.DateFormat.getBestDateTimePattern(java.util.Locale.getDefault(), "MMMMd"),
        java.util.Locale.getDefault(),
    )

    val items = mutableListOf<ChatListItem>()
    var prevMessage: co.ubunifu.pttandroid.model.ChatMessage? = null
    var prevDateKey: String? = null

    for (message in messages) {
        val createdAtMillis = message.createdAtMillis
        val dateKey = createdAtMillis?.let { dateKeyFormat.format(java.util.Date(it)) }

        if (dateKey != null && dateKey != prevDateKey) {
            val label = dateLabelFormat.format(java.util.Date(createdAtMillis!!))
            items += ChatListItem.DateSeparator(key = "date-$dateKey", label = label)
            prevMessage = null // 日付が変わったら必ずヘッダーを出し直す
        }

        val sameSenderAsPrev = prevMessage?.uid == message.uid
        val prevCreatedAt = prevMessage?.createdAtMillis
        val withinGroupWindow =
            sameSenderAsPrev &&
                prevCreatedAt != null &&
                createdAtMillis != null &&
                (createdAtMillis - prevCreatedAt) < CHAT_GROUP_WINDOW_MS
        val showHeader = !withinGroupWindow

        items += ChatListItem.MessageItem(key = message.id, message = message, showHeader = showHeader)

        prevMessage = message
        prevDateKey = dateKey ?: prevDateKey
    }

    return items
}

@Composable
private fun ChatSection(
    messages: List<co.ubunifu.pttandroid.model.ChatMessage>,
    myUid: String?,
    input: String,
    onInputChange: (String) -> Unit,
    errorMessage: String?,
    onSend: () -> Unit,
    // [Phase16] 添付ファイル。Web版ChatPanel.vueのprops/emitと同じ役割分担:
    // 呼び出し元(PTTApp)がtokenServerUrl/roomIdを束縛したURL発行関数を注入する。
    pendingAttachmentName: String?,
    attachmentSending: Boolean,
    onPickAttachment: () -> Unit,
    onSendPendingAttachment: () -> Unit,
    onCancelPendingAttachment: () -> Unit,
    getAttachmentUrl: suspend (String) -> String,
    getThumbnailUrl: suspend (String) -> String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // [Phase16] サムネイルは表示のたびに1回だけ発行し、messageIdをキーに保持する
    // (Web版ChatPanel.vueのthumbSrcByMessageIdと同じ設計)。
    val thumbSrcByMessageId = remember { mutableStateMapOf<String, String>() }

    LaunchedEffect(messages) {
        for (m in messages) {
            val thumbnailPath = m.attachment?.thumbnailPath
            if (thumbnailPath != null && thumbSrcByMessageId[m.id] == null) {
                try {
                    thumbSrcByMessageId[m.id] = getThumbnailUrl(m.id)
                } catch (e: Exception) {
                    // 失敗時は汎用アイコン表示のままにする(Web版と同じくerrorMessageには出さない)
                }
            }
        }
    }

    fun openAttachment(messageId: String) {
        scope.launch {
            try {
                val url = getAttachmentUrl(messageId)
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: Exception) {
                // errorMessageは送受信本体のみに使う(Web版と同じ)
            }
        }
    }

    // [五十七訂・モバイルUI再編との整合] Chatはそれ専用のタブとして全画面を占める
    // (iOS版と同じ構成)ため、メッセージ一覧は固定高さではなく残り縦幅いっぱいに広げる。
    Column(Modifier.fillMaxSize()) {
        Text(stringResource(R.string.chat_title), fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted)
        Spacer(Modifier.height(6.dp))

        val listItems = remember(messages) { buildChatListItems(messages) }

        LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
            items(listItems, key = { it.key }) { item ->
                when (item) {
                    is ChatListItem.DateSeparator -> ChatDateSeparator(item.label)
                    is ChatListItem.MessageItem -> ChatMessageRow(
                        message = item.message,
                        showHeader = item.showHeader,
                        myUid = myUid,
                        thumbUrl = thumbSrcByMessageId[item.message.id],
                        onOpenAttachment = { id -> openAttachment(id) },
                        modifier = Modifier.padding(top = if (item.showHeader) 8.dp else 2.dp),
                    )
                }
            }
        }

        errorMessage?.let { Text(it, color = PTTColors.Danger, fontFamily = Mono, fontSize = 11.sp) }

        if (pendingAttachmentName != null) {
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("\uD83D\uDCCE", fontFamily = Mono, fontSize = 12.sp)
                Spacer(Modifier.width(6.dp))
                Text(
                    pendingAttachmentName,
                    fontFamily = Mono,
                    fontSize = 11.sp,
                    color = PTTColors.Muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(6.dp))
                Button(onClick = onSendPendingAttachment, enabled = !attachmentSending) {
                    Text(stringResource(R.string.chat_attachment_send), fontFamily = Mono)
                }
                Spacer(Modifier.width(6.dp))
                OutlinedButton(onClick = onCancelPendingAttachment, enabled = !attachmentSending) {
                    Text(stringResource(R.string.chat_attachment_cancel), fontFamily = Mono)
                }
            }
        } else {
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(
                    onClick = onPickAttachment,
                    modifier = Modifier
                        .width(48.dp)
                        .semantics { contentDescription = context.getString(R.string.chat_attachment_pick) },
                ) {
                    Text("\uD83D\uDCCE", fontFamily = Mono)
                }
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = input,
                    onValueChange = onInputChange,
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    placeholder = { Text(stringResource(R.string.chat_placeholder), fontFamily = Mono, fontSize = 12.sp) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { onSend() }),
                )
                Spacer(Modifier.width(8.dp))
                Button(onClick = onSend, enabled = input.isNotBlank()) {
                    Text(stringResource(R.string.chat_send), fontFamily = Mono)
                }
            }
        }
    }
}

@Composable
private fun ChatDateSeparator(label: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(
            label,
            fontFamily = Mono,
            fontSize = 10.sp,
            color = PTTColors.Muted,
            modifier = Modifier
                .clip(androidx.compose.foundation.shape.RoundedCornerShape(50))
                .border(BorderStroke(1.dp, PTTColors.Line), androidx.compose.foundation.shape.RoundedCornerShape(50))
                .padding(horizontal = 10.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun ChatMessageRow(
    message: co.ubunifu.pttandroid.model.ChatMessage,
    showHeader: Boolean,
    myUid: String?,
    thumbUrl: String?,
    onOpenAttachment: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val isMine = message.uid == myUid
    val avatarSize = 34.dp

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        if (!isMine) {
            // 相手側アバター列。連続投稿でヘッダーを出さない行は、
            // 位置を揃えるための空スペース
            Box(Modifier.size(avatarSize)) {
                if (showHeader) {
                    ChatAvatarView(
                        uid = message.uid,
                        displayName = message.displayName,
                        role = message.role,
                        photoUrl = message.photoUrl,
                        size = avatarSize,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
        }

        Column(
            horizontalAlignment = if (isMine) Alignment.End else Alignment.Start,
            modifier = Modifier.widthIn(max = 260.dp),
        ) {
            // 相手の名前(自分の発言では名乗る必要が無いため出さない)
            if (!isMine && showHeader) {
                Text(
                    message.displayName,
                    fontFamily = Mono,
                    fontSize = 11.sp,
                    color = PTTColors.Muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
            }

            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (isMine) ChatTimestamp(message.createdAtMillis)
                if (message.text.isNotEmpty()) {
                    ChatBubbleText(message.text, isMine = isMine)
                }
                if (!isMine) ChatTimestamp(message.createdAtMillis)
            }

            message.attachment?.let { attachment ->
                Spacer(Modifier.height(3.dp))
                ChatAttachmentBubble(
                    attachment = attachment,
                    messageId = message.id,
                    thumbUrl = thumbUrl,
                    onOpen = onOpenAttachment,
                )
            }
        }
    }
}

private val chatTimeFormat: java.text.SimpleDateFormat by lazy {
    java.text.SimpleDateFormat(
        android.text.format.DateFormat.getBestDateTimePattern(java.util.Locale.getDefault(), "jm"),
        java.util.Locale.getDefault(),
    )
}

@Composable
private fun ChatTimestamp(createdAtMillis: Long?) {
    Text(
        text = createdAtMillis?.let { chatTimeFormat.format(java.util.Date(it)) } ?: "",
        fontFamily = Mono,
        fontSize = 9.sp,
        color = PTTColors.Muted,
    )
}

/** URLをハイパーリンク化したテキスト吹き出し。`v-html`を使わないWeb版・生のHTML化を
 *  しないiOS版と同様、ClickableText + AnnotatedStringのURLアノテーションのみを使う
 *  ため任意の文字列を安全に扱える。 */
@Composable
private fun ChatBubbleText(text: String, isMine: Boolean) {
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    val annotated = remember(text) {
        androidx.compose.ui.text.buildAnnotatedString {
            for (segment in co.ubunifu.pttandroid.chat.Linkify.segments(text)) {
                if (segment.kind == co.ubunifu.pttandroid.chat.LinkifySegment.Kind.URL) {
                    pushStringAnnotation(tag = "URL", annotation = segment.value)
                    androidx.compose.ui.text.withStyle(
                        androidx.compose.ui.text.SpanStyle(
                            color = PTTColors.Live,
                            textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                        ),
                    ) {
                        append(segment.value)
                    }
                    pop()
                } else {
                    append(segment.value)
                }
            }
        }
    }

    androidx.compose.foundation.text.ClickableText(
        text = annotated,
        style = androidx.compose.ui.text.TextStyle(fontFamily = Mono, fontSize = 13.sp, color = PTTColors.Text),
        modifier = Modifier
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(16.dp))
            .background(if (isMine) PTTColors.Accent.copy(alpha = 0.15f) else PTTColors.Panel.copy(alpha = 0.6f))
            .border(
                BorderStroke(1.dp, if (isMine) PTTColors.Accent.copy(alpha = 0.4f) else PTTColors.Line),
                androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
            )
            .padding(horizontal = 12.dp, vertical = 7.dp),
        onClick = { offset ->
            annotated.getStringAnnotations(tag = "URL", start = offset, end = offset)
                .firstOrNull()
                ?.let { uriHandler.openUri(it.item) }
        },
    )
}

/** [Phase16] 添付ファイルの表示。画像はサムネイルを取得して表示、タップすると
 *  `getAttachmentUrl`で発行した本体の署名付きURLを外部ビューア(ブラウザ等)で開く。
 *  [五十七訂] Web版・iOS版に合わせ、テキスト吹き出しと統一感のある角丸+枠線
 *  スタイルにし、動画/PDFはベクターアイコン(ic_chat_video/ic_chat_document)+
 *  ファイル名で表示する。 */
@Composable
private fun ChatAttachmentBubble(
    attachment: co.ubunifu.pttandroid.model.ChatAttachment,
    messageId: String,
    thumbUrl: String?,
    onOpen: (String) -> Unit,
) {
    if (attachment.kind == AttachmentKind.IMAGE) {
        Box(
            modifier = Modifier
                .clip(androidx.compose.foundation.shape.RoundedCornerShape(16.dp))
                .background(PTTColors.Panel.copy(alpha = 0.6f))
                .border(BorderStroke(1.dp, PTTColors.Line), androidx.compose.foundation.shape.RoundedCornerShape(16.dp))
                .padding(2.dp)
                .clickable { onOpen(messageId) },
        ) {
            if (thumbUrl != null) {
                AsyncImage(
                    model = thumbUrl,
                    contentDescription = attachment.fileName,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .heightIn(max = 140.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(14.dp)),
                )
            } else {
                Text(
                    "[${stringResource(R.string.chat_attachment_loading)}]",
                    fontFamily = Mono,
                    fontSize = 11.sp,
                    color = PTTColors.Muted,
                    modifier = Modifier.padding(8.dp),
                )
            }
        }
    } else {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .clip(androidx.compose.foundation.shape.RoundedCornerShape(16.dp))
                .background(PTTColors.Panel.copy(alpha = 0.6f))
                .border(BorderStroke(1.dp, PTTColors.Line), androidx.compose.foundation.shape.RoundedCornerShape(16.dp))
                .clickable { onOpen(messageId) }
                .padding(horizontal = 10.dp, vertical = 7.dp),
        ) {
            Icon(
                painter = painterResource(
                    if (attachment.kind == AttachmentKind.VIDEO) R.drawable.ic_chat_video else R.drawable.ic_chat_document,
                ),
                contentDescription = null,
                tint = PTTColors.Muted,
                modifier = Modifier.size(15.dp),
            )
            Text(
                attachment.fileName,
                fontFamily = Mono,
                fontSize = 11.sp,
                color = PTTColors.Text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun LogSection(lines: List<String>) {
    Column(Modifier.fillMaxWidth().height(130.dp)) {
        LazyColumn {
            items(lines.takeLast(50)) { line ->
                Text(line, fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted)
            }
        }
    }
}
