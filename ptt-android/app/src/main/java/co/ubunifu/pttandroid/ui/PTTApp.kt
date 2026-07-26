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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
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
import kotlinx.coroutines.launch

private val Mono = FontFamily.Monospace

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
    val createdRoomLabel = stringResource(R.string.room_select_created_room_label)
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
    var activeRoomId by remember { mutableStateOf<String?>(null) }
    var currentInviteCode by remember { mutableStateOf<String?>(null) }
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

    // [送話ロック連携] 自分以外が発話ロックを保持しているか、および相手の表示名
    val someoneElseIsTalking = currentTalkerUid != null && currentTalkerUid != currentUser?.uid
    val currentTalkerName = currentTalkerUid?.let { uid -> participants[uid]?.name ?: uid } ?: ""

    LaunchedEffect(currentUser?.uid) {
        savedRoomsStore.load(currentUser?.uid)
    }

    fun enterRoom(roomId: String) {
        banNotice = null
        activeRoomId = roomId
        chatStore.start(roomId)
        banStore.start(roomId, currentUser?.uid ?: "")
        // [Phase13・次アクションitem3] 参加者一覧のバッジ表示(ポーリング)。
        badgesStore.start(scope, tokenServerUrl, roomId) { authManager.fetchIdToken() }
        connectionManager.connect(
            tokenServerUrl = tokenServerUrl,
            livekitUrl = livekitUrl,
            roomNameParam = roomId,
            idTokenProvider = { authManager.fetchIdToken() },
        )
    }

    fun leaveRoom() {
        if (status !is ConnectionStatus.Disconnected) connectionManager.disconnect()
        chatStore.stop()
        banStore.stop()
        badgesStore.stop()
        activeRoomId = null
        currentInviteCode = null
        joinRoomId = ""
        joinInviteCode = ""
        chatInput = ""
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

    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        HeaderRow(
            currentUserName = authManager.displayName,
            channelLabel = channelLabel(status),
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
                )
                Spacer(Modifier.height(16.dp))
                LogSection(logLines)
            }

            else -> RoomSelectionSection(
                tokenServerUrl = tokenServerUrl,
                onTokenServerUrlChange = { tokenServerUrl = it },
                livekitUrl = livekitUrl,
                onLivekitUrlChange = { livekitUrl = it },
                // [Phase12・十五訂] ここは role ではなく isAnonymous(Firebase Auth)で判定する。
                // 未入室(=どのRoomのmembersドキュメントも持たない)画面のため、role(Room内の
                // 役割)という概念自体がまだ存在しない。role によるGuest判定(上のGuestStatusBar
                // 側、myRole == "guest")とは統一すべき同一軸ではなく、意図的に異なるスコープ
                // (brushup-plan.md Phase12参照)。なお token-server側(POST /rooms)もGuestを
                // 403で拒否するため、ここでのUI非表示はAPI側の強制とは別に、Guestが操作を
                // 試みる前に選択肢自体を見せないためのもの。
                isGuest = currentUser?.isAnonymous == true,
                isWorking = roomWorking,
                errorMessage = roomError,
                savedRooms = savedRooms,
                onCreateRoom = {
                    roomManager.clearError()
                    scope.launch {
                        try {
                            val idToken = authManager.fetchIdToken()
                            val created = roomManager.createRoom(tokenServerUrl, idToken)
                            currentInviteCode = created.inviteCode
                            savedRoomsStore.upsert(created.roomId, createdRoomLabel, created.inviteCode)
                            enterRoom(created.roomId)
                        } catch (e: Exception) {
                            // roomManager.lastErrorMessage に理由がセットされている
                        }
                    }
                },
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
                            roomManager.joinRoom(tokenServerUrl, idToken, roomId, inviteCode)
                            currentInviteCode = inviteCode // 参加者自身が入力したコードをそのまま保持する(以前はnullで潰していたため招待コード欄が表示されなかった)
                            savedRoomsStore.upsert(roomId, joinedRoomLabel, inviteCode)
                            enterRoom(roomId)
                        } catch (e: Exception) {
                            // roomManager.lastErrorMessage に理由がセットされている
                        }
                    }
                },
                onRejoinSaved = { saved ->
                    currentInviteCode = saved.inviteCode
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

@Composable
private fun channelLabel(status: ConnectionStatus): String = when (status) {
    is ConnectionStatus.Connected -> "room: ${status.room}"
    is ConnectionStatus.Reconnecting -> "room: ${status.room}"
    else -> stringResource(R.string.common_not_connected)
}

@Composable
private fun HeaderRow(currentUserName: String?, channelLabel: String, onSignOut: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("PTT CLIENT", fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted)
        if (currentUserName != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(currentUserName, fontFamily = Mono, fontSize = 12.sp)
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.header_sign_out),
                    fontFamily = Mono,
                    fontSize = 11.sp,
                    color = PTTColors.Muted,
                    modifier = Modifier.pointerInput(Unit) {
                        detectTapGestures(onTap = { onSignOut() })
                    },
                )
            }
        }
        Text(channelLabel, fontFamily = Mono, fontSize = 13.sp)
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
    isGuest: Boolean,
    isWorking: Boolean,
    errorMessage: String?,
    savedRooms: List<SavedRoom>,
    onCreateRoom: () -> Unit,
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

        // [Phase10: Guestロール] Guestはルームを作成できない(token-server側では検証していないが、
        // Web版RoomSelectView.vueと同じくクライアントUIとしてボタン自体を隠す)。
        if (!isGuest) {
            Button(
                onClick = onCreateRoom,
                enabled = !isWorking,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = PTTColors.Accent),
            ) {
                if (isWorking) CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White)
                else Text(stringResource(R.string.room_select_create_room), fontFamily = Mono)
            }
        } else {
            Text(
                stringResource(R.string.room_select_guest_cannot_create),
                fontFamily = Mono, fontSize = 11.sp, color = PTTColors.Muted,
            )
        }

        Text(stringResource(R.string.common_or_divider), fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted, modifier = Modifier.fillMaxWidth())

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
) {
    Column(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.chat_title), fontFamily = Mono, fontSize = 10.sp, color = PTTColors.Muted)
        Spacer(Modifier.height(6.dp))
        LazyColumn(Modifier.fillMaxWidth().height(160.dp)) {
            items(messages) { message ->
                Text(
                    "${message.displayName}: ${message.text}",
                    fontFamily = Mono,
                    fontSize = 12.sp,
                    color = if (message.uid == myUid) PTTColors.Live else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        errorMessage?.let { Text(it, color = PTTColors.Danger, fontFamily = Mono, fontSize = 11.sp) }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
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
