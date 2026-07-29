/**
 * PTTStatusIcons.kt
 *
 * [接続状態・ログイン状態のアイコン化]
 * Web版(ptt-client/src/components/ConnectionStatusIcon.vue・LoginStatusIcon.vue)の
 * デザインをComposeへ移植したもの。従来HeaderRow内でテキスト直書きしていた
 * 「room: {roomId} / 未接続」「{userName} + サインアウト」を、丸型28dpのアイコン
 * 2つ(接続状態アイコン・ログイン状態アイコン)に置き換える。
 *
 * [接続状態アイコン(ConnectionStatusIcon)]
 * Web版と同じルール: connected/reconnecting のみ「ライブ」として扱い、ルームIDの
 * 先頭1文字を丸の中に表示する。それ以外(disconnected/connecting/error)は
 * 「未接続」として、文字の代わりに簡易的な「オフ」を表す斜線入り丸グリフを描く。
 * 色分けもWeb版に合わせ、connected=Live、reconnecting=Warning(かつ点滅)、
 * それ以外=Mutedの破線相当(実装簡略化のため実線の薄いボーダーで代替)とする。
 *
 * [ログイン状態アイコン(LoginStatusIcon)]
 * Web版はlucideの`User`アイコンを使うが、本プロジェクトはmaterial-icons-extended
 * への依存を増やさない方針(PTTOnboardingScreen.ktのコメント参照)のため、
 * 自前のvector drawable(R.drawable.ic_person)をプレースホルダーとして使う。
 * Googleサインイン済みでphotoUrlがある場合はCoilで丸型に読み込み、
 * 読み込み失敗時(オフライン等)や写真を持たないアカウント(ゲスト・Apple ID等)は
 * プレースホルダーへフォールバックする。タップすると簡易メニュー
 * (表示名 + サインアウト)を開く、Web版と同じ挙動。
 */
package co.ubunifu.pttandroid.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.ubunifu.pttandroid.R
import co.ubunifu.pttandroid.model.ConnectionStatus
import co.ubunifu.pttandroid.ui.theme.PTTColors
import coil.compose.SubcomposeAsyncImage

private val Mono = FontFamily.Monospace
private val IconBadgeSize = 28.dp

/**
 * ルームへの接続状態を表す丸型アイコン。
 * Web版ConnectionStatusIcon.vueの isLive/isReconnecting/initial ロジックをそのまま踏襲する。
 */
@Composable
fun ConnectionStatusIcon(
    status: ConnectionStatus,
    modifier: Modifier = Modifier,
    // [表示アイコンの文字] admin-dashboardで設定されたルーム名(PTTApp.ktのcurrentRoomName)。
    // nullでない場合はこちらの頭文字を優先し、未設定/未取得(null)の場合のみ
    // roomId(ConnectionStatusから取れるルームID)の頭文字にフォールバックする。
    // Web版 ConnectionStatusIcon.vue の roomName prop の移植。
    roomName: String? = null,
) {
    val isLive = status is ConnectionStatus.Connected || status is ConnectionStatus.Reconnecting
    val isReconnecting = status is ConnectionStatus.Reconnecting
    val roomId = when (status) {
        is ConnectionStatus.Connected -> status.room
        is ConnectionStatus.Reconnecting -> status.room
        else -> null
    }
    // サロゲートペアを考慮し、StringのcodePointベースで先頭1文字を取る
    // (Web版の `[...roomId][0]` と同じ意図)。
    val initial = (roomName ?: roomId)?.let { id ->
        if (id.isEmpty()) "" else id.substring(0, Character.charCount(id.codePointAt(0))).uppercase()
    } ?: ""

    val liveColor = if (isReconnecting) PTTColors.Warning else PTTColors.Live
    val label = if (isLive) {
        stringResource(R.string.common_connected_to_room, roomId ?: "")
    } else {
        stringResource(R.string.common_not_connected)
    }

    // [再接続中の点滅] Web版の `animate-pulse` に相当。
    val infiniteTransition = rememberInfiniteTransition(label = "connectionStatusPulse")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (isReconnecting) 0.4f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "connectionStatusPulseAlpha",
    )

    Box(
        modifier
            .size(IconBadgeSize)
            .clip(CircleShape)
            .then(
                if (isLive) {
                    Modifier
                        .background(liveColor.copy(alpha = 0.15f * pulseAlpha))
                        .border(BorderStroke(1.dp, liveColor.copy(alpha = 0.4f)), CircleShape)
                } else {
                    Modifier.border(BorderStroke(1.dp, PTTColors.Muted.copy(alpha = 0.35f)), CircleShape)
                },
            )
            .semanticsLabel(label),
        contentAlignment = Alignment.Center,
    ) {
        if (isLive) {
            Text(
                initial,
                fontFamily = Mono,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = liveColor,
            )
        } else {
            OfflineGlyph()
        }
    }
}

/** 「未接続」を表す簡易グリフ(丸に斜線)。Web版のlucide `WifiOff` の代替。 */
@Composable
private fun OfflineGlyph() {
    androidx.compose.foundation.Canvas(modifier = Modifier.size(14.dp)) {
        val strokeWidth = 1.6.dp.toPx()
        drawCircle(
            color = PTTColors.Muted,
            radius = size.minDimension / 2f - strokeWidth / 2f,
            style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
        )
        drawLine(
            color = PTTColors.Muted,
            start = androidx.compose.ui.geometry.Offset(size.width * 0.18f, size.height * 0.18f),
            end = androidx.compose.ui.geometry.Offset(size.width * 0.82f, size.height * 0.82f),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round,
        )
    }
}

/**
 * ログイン状態を表す丸型アイコン。タップで表示名+サインアウトの簡易メニューを開く。
 * Web版LoginStatusIcon.vueの構成(アイコン本体 + クリックで開くポップアップメニュー)を踏襲。
 */
@Composable
fun LoginStatusIcon(
    photoUrl: String?,
    displayName: String?,
    isSignedIn: Boolean,
    onSignOut: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    // 画像読み込みに失敗した場合(オフライン等)はプレースホルダーへフォールバックする
    // (Web版のimageFailed refと同じ意図)。SubcomposeAsyncImageのerrorスロットで判定する。
    val label = if (isSignedIn) {
        stringResource(R.string.common_logged_in_as, displayName ?: "")
    } else {
        stringResource(R.string.common_not_logged_in)
    }

    Box {
        Box(
            Modifier
                .size(IconBadgeSize)
                .clip(CircleShape)
                .background(PTTColors.Panel)
                .border(BorderStroke(1.dp, PTTColors.Line), CircleShape)
                .clickable { open = !open }
                .semanticsLabel(label),
            contentAlignment = Alignment.Center,
        ) {
            AvatarContent(photoUrl)
        }

        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (isSignedIn) {
                Column(Modifier.width(180.dp).padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Text(
                        displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.room_nickname_unset),
                        fontFamily = Mono,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.header_sign_out), fontFamily = Mono, color = PTTColors.Danger) },
                    onClick = {
                        open = false
                        onSignOut()
                    },
                )
            } else {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.common_not_logged_in), fontFamily = Mono, color = PTTColors.Muted) },
                    onClick = { open = false },
                )
            }
        }
    }
}

@Composable
private fun AvatarContent(photoUrl: String?) {
    if (photoUrl.isNullOrBlank()) {
        PersonPlaceholder()
        return
    }
    SubcomposeAsyncImage(
        model = photoUrl,
        contentDescription = null,
        modifier = Modifier
            .size(IconBadgeSize)
            .clip(CircleShape),
        error = { PersonPlaceholder() },
        loading = { PersonPlaceholder() },
    )
}

@Composable
private fun PersonPlaceholder() {
    Icon(
        painter = painterResource(R.drawable.ic_person),
        contentDescription = null,
        tint = PTTColors.Muted,
        modifier = Modifier.size(14.dp),
    )
}

/** role=imgのアクセシビリティラベルに相当する簡易ヘルパー(TalkBack用のcontentDescription付与)。 */
private fun Modifier.semanticsLabel(label: String): Modifier =
    this.semantics { contentDescription = label }
