/**
 * PTTApp.kt
 *
 * [LiveKit移行 + Firebase Auth対応 + 招待制ルーム対応 + Phase5テキストチャット + 送話ロック連携]
 * Web版(ptt-client/public/index.html)・iOS版(ContentView.swift)と同等のUI:
 * Googleサインイン → ルーム作成/招待コード参加 → PTTボタン → 送話中リスト → チャット → ログ
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.ubunifu.pttandroid.auth.PTTAuthManager
import co.ubunifu.pttandroid.ban.PTTBanStore
import co.ubunifu.pttandroid.chat.PTTChatStore
import co.ubunifu.pttandroid.connection.PTTConnectionManager
import co.ubunifu.pttandroid.model.ConnectionStatus
import co.ubunifu.pttandroid.model.ParticipantInfo
import co.ubunifu.pttandroid.room.PTTRoomManager
import co.ubunifu.pttandroid.room.PTTSavedRoomsStore
import co.ubunifu.pttandroid.room.SavedRoom
import kotlinx.coroutines.launch

private val Live = Color(0xFF3DDC84)
private val Danger = Color(0xFFFF5C5C)
private val Accent = Color(0xFFFF7A3C)
private val Muted = Color(0xFF6F8079)
private val Mono = FontFamily.Monospace

@Composable
fun PTTApp(
    authManager: PTTAuthManager,
    roomManager: PTTRoomManager,
    savedRoomsStore: PTTSavedRoomsStore,
    connectionManager: PTTConnectionManager,
    chatStore: PTTChatStore,
    banStore: PTTBanStore,
    onRequestGoogleSignIn: () -> Unit,
) {
    val scope = rememberCoroutineScope()

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
            banNotice = "このルームから排除されました"
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

    Column(Modifier.fillMaxWidth().padding(16.dp)) {
        HeaderRow(
            currentUserName = authManager.displayName,
            channelLabel = channelLabel(status),
            onSignOut = { leaveRoom(); authManager.signOut() },
        )

        banNotice?.let { notice ->
            Text(notice, fontFamily = Mono, fontSize = 12.sp, color = Danger)
            Spacer(Modifier.height(8.dp))
        }

        when {
            currentUser == null -> AuthSection(
                errorMessage = authError,
                onSignIn = onRequestGoogleSignIn,
            )

            activeRoomId != null -> {
                StatusRow(status)
                InviteBox(currentInviteCode, activeRoomId)
                OutlinedButton(onClick = { leaveRoom() }, modifier = Modifier.fillMaxWidth()) {
                    Text("ルームを退出する", fontFamily = Mono)
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
                    canBan = myRole == "owner" || myRole == "moderator",
                    onRequestBan = { banTarget = it },
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
                            savedRoomsStore.upsert(created.roomId, "自分が作成したルーム", created.inviteCode)
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
                            savedRoomsStore.upsert(roomId, "招待コードで参加したルーム", inviteCode)
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
            title = { Text("BANしますか?", fontFamily = Mono) },
            text = {
                Text(
                    "${target.name} をこのルームからBANしますか?\nこの操作は取り消せません。",
                    fontFamily = Mono,
                )
            },
            confirmButton = {
                Button(
                    onClick = { confirmBan(target) },
                    colors = ButtonDefaults.buttonColors(containerColor = Danger),
                ) {
                    Text("BANする", fontFamily = Mono)
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { banTarget = null }) {
                    Text("キャンセル", fontFamily = Mono)
                }
            },
        )
    }
}

private fun channelLabel(status: ConnectionStatus): String = when (status) {
    is ConnectionStatus.Connected -> "room: ${status.room}"
    is ConnectionStatus.Reconnecting -> "room: ${status.room}"
    else -> "未接続"
}

@Composable
private fun HeaderRow(currentUserName: String?, channelLabel: String, onSignOut: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("PTT CLIENT", fontFamily = Mono, fontSize = 11.sp, color = Muted)
        if (currentUserName != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(currentUserName, fontFamily = Mono, fontSize = 12.sp)
                Spacer(Modifier.width(8.dp))
                Text(
                    "サインアウト",
                    fontFamily = Mono,
                    fontSize = 11.sp,
                    color = Muted,
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
private fun AuthSection(errorMessage: String?, onSignIn: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(
            onClick = onSignIn,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Accent),
        ) {
            Text("Googleでサインイン", fontFamily = Mono)
        }
        errorMessage?.let { Text(it, color = Danger, fontFamily = Mono, fontSize = 11.sp) }
    }
}

@Composable
private fun StatusRow(status: ConnectionStatus) {
    val (color, text) = when (status) {
        is ConnectionStatus.Disconnected -> Muted to "サーバ未接続"
        is ConnectionStatus.Connecting -> Muted to "接続中..."
        is ConnectionStatus.Connected -> Live to "接続中 (room=${status.room})"
        is ConnectionStatus.Reconnecting -> Color(0xFFF3B833) to "再接続中... (room=${status.room})"
        is ConnectionStatus.Error -> Danger to "エラー: ${status.message}"
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
        Text(text, fontFamily = Mono, fontSize = 12.sp, color = Muted)
    }
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun InviteBox(inviteCode: String?, roomId: String?) {
    if (inviteCode == null || roomId == null) return
    Card(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Column(Modifier.padding(10.dp)) {
            Text("このルームの招待コード(参加者に共有してください):", fontFamily = Mono, fontSize = 12.sp)
            Text(inviteCode, fontFamily = Mono, fontSize = 18.sp, color = Accent)
            Text("ルームID: $roomId", fontFamily = Mono, fontSize = 12.sp, color = Muted)
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
            label = { Text("トークンサーバーURL", fontFamily = Mono, fontSize = 10.sp) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedTextField(
            value = livekitUrl,
            onValueChange = onLivekitUrlChange,
            label = { Text("LiveKit URL (wss://)", fontFamily = Mono, fontSize = 10.sp) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        Button(
            onClick = onCreateRoom,
            enabled = !isWorking,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Accent),
        ) {
            if (isWorking) CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White)
            else Text("新しいルームを作成する", fontFamily = Mono)
        }

        Text("— または —", fontFamily = Mono, fontSize = 10.sp, color = Muted, modifier = Modifier.fillMaxWidth())

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                value = joinRoomId,
                onValueChange = onJoinRoomIdChange,
                label = { Text("ルームID", fontFamily = Mono, fontSize = 10.sp) },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            OutlinedTextField(
                value = joinInviteCode,
                onValueChange = onJoinInviteCodeChange,
                label = { Text("招待コード", fontFamily = Mono, fontSize = 10.sp) },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
        }
        OutlinedButton(onClick = onJoinRoom, enabled = !isWorking, modifier = Modifier.fillMaxWidth()) {
            Text("招待コードで参加する", fontFamily = Mono)
        }

        errorMessage?.let { Text(it, color = Danger, fontFamily = Mono, fontSize = 11.sp) }

        if (savedRooms.isNotEmpty()) {
            Text(
                "— 最近使ったルーム —",
                fontFamily = Mono, fontSize = 10.sp, color = Muted,
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
                    fontFamily = Mono, fontSize = 11.sp, color = Muted,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(
            "削除",
            fontFamily = Mono, fontSize = 11.sp, color = Muted,
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
                    color = if (isSending) Accent else Color.Gray.copy(alpha = 0.4f),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(width = 4f),
                )
            }
            Text(
                text = when {
                    isSending -> "送話中"
                    someoneElseTalking -> "$talkerName が送話中"
                    else -> "押して送話"
                },
                fontFamily = Mono,
                fontSize = 13.sp,
                color = if (isSending) Accent else Muted,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.padding(horizontal = 10.dp),
            )
        }
        Spacer(Modifier.height(14.dp))
        Text(
            "ボタンを押している間だけ音声が送信されます",
            fontFamily = Mono, fontSize = 11.sp, color = Muted,
        )
    }
}

@Composable
private fun ParticipantsSection(
    participants: Map<String, ParticipantInfo>,
    myUid: String?,
    canBan: Boolean,
    onRequestBan: (ParticipantInfo) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Text("参加者(緑=送話中)", fontFamily = Mono, fontSize = 10.sp, color = Muted)
        Spacer(Modifier.height(6.dp))
        if (participants.isEmpty()) {
            Text("— なし —", fontFamily = Mono, fontSize = 11.sp, color = Muted)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                participants.values.sortedBy { it.name }.forEach { info ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            info.name,
                            fontFamily = Mono,
                            fontSize = 11.sp,
                            color = if (!info.muted) Live else Muted,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        // [BAN対応] owner/moderatorのみBANボタンを表示する
                        // (サーバー側でも権限を再チェックする)。自分自身は対象外。
                        if (canBan && info.identity != myUid) {
                            Text(
                                "BAN",
                                fontFamily = Mono,
                                fontSize = 10.sp,
                                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                                color = Danger,
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
        Text("チャット", fontFamily = Mono, fontSize = 10.sp, color = Muted)
        Spacer(Modifier.height(6.dp))
        LazyColumn(Modifier.fillMaxWidth().height(160.dp)) {
            items(messages) { message ->
                Text(
                    "${message.displayName}: ${message.text}",
                    fontFamily = Mono,
                    fontSize = 12.sp,
                    color = if (message.uid == myUid) Live else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        errorMessage?.let { Text(it, color = Danger, fontFamily = Mono, fontSize = 11.sp) }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = input,
                onValueChange = onInputChange,
                modifier = Modifier.weight(1f),
                singleLine = true,
                placeholder = { Text("メッセージを入力", fontFamily = Mono, fontSize = 12.sp) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { onSend() }),
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = onSend, enabled = input.isNotBlank()) {
                Text("送信", fontFamily = Mono)
            }
        }
    }
}

@Composable
private fun LogSection(lines: List<String>) {
    Column(Modifier.fillMaxWidth().height(130.dp)) {
        LazyColumn {
            items(lines.takeLast(50)) { line ->
                Text(line, fontFamily = Mono, fontSize = 10.sp, color = Muted)
            }
        }
    }
}