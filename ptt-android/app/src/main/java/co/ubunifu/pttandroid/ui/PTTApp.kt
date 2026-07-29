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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.material3.Card
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
import co.ubunifu.pttandroid.ban.PTTBanStore
import co.ubunifu.pttandroid.ban.PTTRoomPermissions
import co.ubunifu.pttandroid.chat.PTTChatStore
import co.ubunifu.pttandroid.connection.PTTConnectionManager
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
import co.ubunifu.pttandroid.room.SavedRoom
import co.ubunifu.pttandroid.ui.theme.PTTColors
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

private val Mono = FontFamily.Monospace

/** [不具合調査用] ファイル選択画面から戻ると在室中のルームが失われる件のログタグ。 */
private const val TAG = "PTTApp"

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
    onboardingStore: PTTOnboardingStore,
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
    // [ルーム名] admin-dashboardで設定された名前が無い場合に履歴欄で使うフォールバックラベル
    // (Web版RoomSelectView.vueの roomSelect.joinedRoomLabel と同じ役割)。
    val joinedRoomLabel = stringResource(R.string.room_select_joined_room_label)

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
    // [送話ロック連携] サーバー(routes/talk.js)がRoom Metadataに書き込むcurrentTalker(uid)。
    // 自分以外のuidが入っている間はPTTボタンを無効化する。
    val currentTalkerUid by connectionManager.currentTalkerUid.collectAsState()

    var tokenServerUrl by remember { mutableStateOf("https://ptt-token-server-rnn4fqay3a-an.a.run.app") }
    var livekitUrl by remember { mutableStateOf("wss://ubunifu-talk-wy19xst3.livekit.cloud") }
    var joinRoomId by remember { mutableStateOf("") }
    var joinInviteCode by remember { mutableStateOf("") }
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
            roomManager.fetchRoomName(tokenServerUrl, idToken, roomId)?.let { name ->
                currentRoomName = name
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

    // [チャット添付UI追加に伴う修正] 画面全体が縦スクロール無しの固定Columnだったため、
    // チャット欄・添付ファイルの確認行など縦方向のコンテンツが増えると画面下端が
    // 見えなくなる(送信ボタンやログ欄に到達できない)不具合があった。
    // verticalScrollを付与し、画面全体をスクロール可能にする。
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        HeaderRow(
            // [表示名の優先順位] Web版App.vueのheaderDisplayNameと同じ: ルーム内で変更した
            // ニックネーム(myDisplayName)があればそれを優先し、無ければFirebase Authの値
            // (authManager.displayName、内部でdisplayName→emailの順にフォールバック済み)を使う。
            currentUserName = myDisplayName ?: authManager.displayName,
            photoUrl = currentUser?.photoUrl?.toString(),
            isSignedIn = currentUser != null,
            status = status,
            roomName = currentRoomName,
            onSignOut = { leaveRoom(); authManager.signOut() },
        )

        banNotice?.let { notice ->
            Text(notice, fontFamily = Mono, fontSize = 12.sp, color = PTTColors.Danger)
            Spacer(Modifier.height(8.dp))
        }

        when {
            currentUser == null -> AuthSection(
                errorMessage = authError,
                onSignIn = onRequestGoogleSignIn,
                onSignInAsGuest = { scope.launch { authManager.signInAsGuest() } },
            )

            activeRoomId != null -> {
                // [ルーム名] admin-dashboardで設定された名前。未取得の場合は表示しない
                // (roomIdはStatusRow側で常に表示されるため、名前は補助的な表示。
                // Web版RoomView.vueのh1と同じ位置づけ)。
                currentRoomName?.let { name ->
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
                StatusRow(status)
                GuestStatusBar(
                    isGuest = myRole == "guest",
                    displayName = myDisplayName,
                    updating = nicknameUpdating,
                    errorMessage = nicknameError,
                    onUpdateNickname = { name ->
                        val roomId = activeRoomId ?: return@GuestStatusBar
                        scope.launch {
                            try {
                                val idToken = authManager.fetchIdToken()
                                banStore.updateNickname(tokenServerUrl, idToken, roomId, name)
                            } catch (e: Exception) {
                                // banStore.nicknameErrorMessage に理由がセットされているのでUIには既に反映済み
                            }
                        }
                    },
                )
                RecordingSection(
                    isRecording = isRecording,
                    recordingStartedAt = recordingStartedAt,
                    // [Phase12・十五訂] role分岐はPTTRoomPermissions.ktに集約(token-server/lib/permissions.jsとCI同期)。
                    canControl = PTTRoomPermissions.canManageRoom(myRole),
                    starting = recordingStarting,
                    stopping = recordingStopping,
                    errorMessage = recordingError,
                    onRequestStart = { showRecordingStartConfirm = true },
                    onStop = { stopRecording() },
                )
                InviteBox(currentInviteCode, activeRoomId)
                OutlinedButton(onClick = { leaveRoom() }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.room_leave_room), fontFamily = Mono)
                }
                Spacer(Modifier.height(20.dp))
                TalkArea(
                    isConnected = status is ConnectionStatus.Connected,
                    isSending = isSending,
                    someoneElseTalking = someoneElseIsTalking,
                    talkerName = currentTalkerName,
                    onStart = { connectionManager.startTalking() },
                    onStop = { connectionManager.stopTalking() },
                )
                Spacer(Modifier.height(16.dp))
                ParticipantsSection(
                    participants = participants,
                    myUid = currentUser?.uid,
                    // [Phase12・十五訂] role分岐はPTTRoomPermissions.ktに集約(token-server/lib/permissions.jsとCI同期)。
                    canBan = PTTRoomPermissions.canManageRoom(myRole),
                    onRequestBan = { banTarget = it },
                    onRequestReport = { reportTarget = it; reportReasonText = "" },
                    reportError = reportError,
                    // [Phase13・次アクションitem3] uid -> 最優先1件のバッジ。
                    topBadges = badgesByUid.mapValues { (_, entry) -> entry.topBadge },
                )
                Spacer(Modifier.height(16.dp))
                ChatSection(
                    messages = chatMessages,
                    myUid = currentUser?.uid,
                    input = chatInput,
                    onInputChange = { chatInput = it },
                    errorMessage = chatError,
                    onSend = {
                        val roomId = activeRoomId ?: return@ChatSection
                        val text = chatInput
                        if (text.isBlank()) return@ChatSection
                        chatInput = ""
                        scope.launch {
                            try {
                                val idToken = authManager.fetchIdToken()
                                chatStore.sendMessage(tokenServerUrl, idToken, roomId, text)
                            } catch (e: Exception) {
                                chatInput = text
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
                Spacer(Modifier.height(16.dp))
                LogSection(logLines)
            }

            else -> RoomSelectionSection(
                tokenServerUrl = tokenServerUrl,
                onTokenServerUrlChange = { tokenServerUrl = it },
                livekitUrl = livekitUrl,
                onLivekitUrlChange = { livekitUrl = it },
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
                    if (roomId.isEmpty() || inviteCode.isEmpty()) return@RoomSelectionSection
                    roomManager.clearError()
                    scope.launch {
                        try {
                            val idToken = authManager.fetchIdToken()
                            val joined = roomManager.joinRoom(tokenServerUrl, idToken, roomId, inviteCode)
                            currentInviteCode = inviteCode // 参加者自身が入力したコードをそのまま保持する(以前はnullで潰していたため招待コード欄が表示されなかった)
                            currentRoomName = joined.name
                            // ルーム名が取得できていればそれを履歴の表示ラベルに使い、
                            // 未設定の場合のみ従来通りの汎用ラベルにフォールバックする
                            // (Web版RoomSelectView.vueと同じ方針)。
                            savedRoomsStore.upsert(roomId, joined.name ?: joinedRoomLabel, inviteCode)
                            enterRoom(roomId)
                        } catch (e: Exception) {
                            // roomManager.lastErrorMessage に理由がセットされている
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
            )
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

/**
 * [アイコン化]
 * Web版(AppHeader.vue)と同じ構成に合わせ、従来ここにテキストで直書きしていた
 * 「room: {roomId} / 未接続」「{userName} + サインアウト」を、丸型28dpの
 * 接続状態アイコン(ConnectionStatusIcon)・ログイン状態アイコン(LoginStatusIcon)に
 * 置き換えた。詳細な接続状態(ルーム名を含むテキスト)は入室後、引き続き
 * StatusRow(この下で別途表示)がWeb版RoomView.vue内のStatusRowと同じ役割を担う。
 */
@Composable
private fun HeaderRow(
    currentUserName: String?,
    photoUrl: String?,
    isSignedIn: Boolean,
    status: ConnectionStatus,
    roomName: String?,
    onSignOut: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.header_app_name), fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted)
        Row(verticalAlignment = Alignment.CenterVertically) {
            ConnectionStatusIcon(status, roomName = roomName)
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

@Composable
private fun AuthSection(errorMessage: String?, onSignIn: () -> Unit, onSignInAsGuest: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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

@Composable
private fun StatusRow(status: ConnectionStatus) {
    val (color, text) = when (status) {
        is ConnectionStatus.Disconnected -> PTTColors.Muted to stringResource(R.string.status_disconnected)
        is ConnectionStatus.Connecting -> PTTColors.Muted to stringResource(R.string.status_connecting)
        is ConnectionStatus.Connected -> PTTColors.Live to stringResource(R.string.status_connected, status.room)
        is ConnectionStatus.Reconnecting -> PTTColors.Warning to stringResource(R.string.status_reconnecting, status.room)
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
        Spacer(Modifier.width(8.dp))
        Text(text, fontFamily = Mono, fontSize = 12.sp, color = PTTColors.Muted)
    }
    Spacer(Modifier.height(10.dp))
}

/**
 * [Phase10: Guestロール 5.1]
 * Web版(GuestStatusBar.vue)の移植。「自分自身がGuestとして参加していること」の表示と、
 * ニックネーム変更を担う。他の参加者がGuestかどうかはクライアントからは判定できない
 * (firestore.rulesにより自分自身のmembersドキュメントしか読めないため)。
 * そのため、ここでは自分自身の状態のみを扱う。
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

@Composable
private fun InviteBox(inviteCode: String?, roomId: String?) {
    if (inviteCode == null || roomId == null) return
    Card(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Column(Modifier.padding(10.dp)) {
            Text(stringResource(R.string.invite_label), fontFamily = Mono, fontSize = 12.sp)
            Text(inviteCode, fontFamily = Mono, fontSize = 18.sp, color = PTTColors.Accent)
            Text(stringResource(R.string.invite_room_id, roomId), fontFamily = Mono, fontSize = 12.sp, color = PTTColors.Muted)
        }
    }
}

/**
 * [録音開始/停止UI]
 * Web版(RecordingBar.vue)・iOS版(ContentView.swiftのrecordingSection)の移植。
 * - 録音中であることの開示(赤バッジ + 経過時間 + 同意文言)はロールに関わらず
 *   全参加者へ常時表示する(法的な同意の観点で必須。Web版・iOS版と同じ方針)。
 * - 開始/停止ボタンはowner/moderatorのみ表示する(サーバー側でも権限を再チェックする)。
 */
@Composable
private fun RecordingSection(
    isRecording: Boolean,
    recordingStartedAt: Long?,
    canControl: Boolean,
    starting: Boolean,
    stopping: Boolean,
    errorMessage: String?,
    onRequestStart: () -> Unit,
    onStop: () -> Unit,
) {
    if (!isRecording && !canControl) return

    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        if (isRecording) {
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

        if (canControl) {
            Spacer(Modifier.height(6.dp))
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
}

@Composable
private fun RoomSelectionSection(
    tokenServerUrl: String,
    onTokenServerUrlChange: (String) -> Unit,
    livekitUrl: String,
    onLivekitUrlChange: (String) -> Unit,
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
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = tokenServerUrl,
            onValueChange = onTokenServerUrlChange,
            label = { Text(stringResource(R.string.auth_token_server_url), fontFamily = Mono, fontSize = 10.sp) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = livekitUrl,
            onValueChange = onLivekitUrlChange,
            label = { Text(stringResource(R.string.auth_livekit_url), fontFamily = Mono, fontSize = 10.sp) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        // [ルーム作成のadmin-dashboard移管] ルーム作成はadmin-dashboard専用の
        // POST /admin/rooms(rooms:create権限)に一本化した。ptt-androidは常に
        // 既存ルームへの参加(招待コードでのjoin)のみを行う画面になっている
        // (Web版RoomSelectView.vueと同じ。brushup-plan.md参照)。これにより、
        // isAnonymous(Guest)によるボタン出し分けも不要になった。
        Text(
            stringResource(R.string.room_select_join_only_hint),
            fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted,
        )

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
                Text(saved.label, fontFamily = Mono, fontSize = 12.sp, maxLines = 1)
                Text(
                    "(${saved.roomId})",
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
    }
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

    Column(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.chat_title), fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted)
        Spacer(Modifier.height(6.dp))
        LazyColumn(Modifier.fillMaxWidth().height(160.dp)) {
            items(messages) { message ->
                Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    if (message.text.isNotEmpty()) {
                        Text(
                            "${message.displayName}: ${message.text}",
                            fontFamily = Mono,
                            fontSize = 12.sp,
                            color = if (message.uid == myUid) PTTColors.Live else MaterialTheme.colorScheme.onSurface,
                        )
                    } else {
                        Text(
                            message.displayName,
                            fontFamily = Mono,
                            fontSize = 12.sp,
                            color = if (message.uid == myUid) PTTColors.Live else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    message.attachment?.let { attachment ->
                        Spacer(Modifier.height(2.dp))
                        if (attachment.kind == AttachmentKind.IMAGE) {
                            val thumbUrl = thumbSrcByMessageId[message.id]
                            if (thumbUrl != null) {
                                AsyncImage(
                                    model = thumbUrl,
                                    contentDescription = attachment.fileName,
                                    contentScale = ContentScale.Fit,
                                    modifier = Modifier
                                        .height(96.dp)
                                        .clickable { openAttachment(message.id) },
                                )
                            } else {
                                Text(
                                    "[${stringResource(R.string.chat_attachment_loading)}]",
                                    fontFamily = Mono,
                                    fontSize = 11.sp,
                                    color = PTTColors.Muted,
                                    modifier = Modifier.clickable { openAttachment(message.id) },
                                )
                            }
                        } else {
                            val icon = if (attachment.kind == AttachmentKind.VIDEO) "\uD83C\uDFAC" else "\uD83D\uDCC4"
                            Text(
                                "$icon ${attachment.fileName}",
                                fontFamily = Mono,
                                fontSize = 11.sp,
                                color = PTTColors.Muted,
                                modifier = Modifier.clickable { openAttachment(message.id) },
                            )
                        }
                    }
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
private fun LogSection(lines: List<String>) {
    Column(Modifier.fillMaxWidth().height(130.dp)) {
        LazyColumn {
            items(lines.takeLast(50)) { line ->
                Text(line, fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted)
            }
        }
    }
}
