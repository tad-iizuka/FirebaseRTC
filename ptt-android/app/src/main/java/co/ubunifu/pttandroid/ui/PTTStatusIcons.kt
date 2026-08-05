/**
 * PTTStatusIcons.kt
 *
 * [ログイン状態のアイコン化]
 * Web版(ptt-client/src/components/LoginStatusIcon.vue)のデザインをComposeへ
 * 移植したもの。従来HeaderRow内でテキスト直書きしていた「{userName} + サインアウト」を、
 * 丸型28dpのログイン状態アイコンに置き換える。
 *
 * [ログイン状態アイコン(LoginStatusIcon)]
 * Web版はlucideの`User`アイコンを使うが、本プロジェクトはmaterial-icons-extended
 * への依存を増やさない方針(PTTOnboardingScreen.ktのコメント参照)のため、
 * 自前のvector drawable(R.drawable.ic_person)をプレースホルダーとして使う。
 * Googleサインイン済みでphotoUrlがある場合はCoilで丸型に読み込み、
 * 読み込み失敗時(オフライン等)や写真を持たないアカウント(ゲスト・Apple ID等)は
 * プレースホルダーへフォールバックする。タップすると簡易メニュー
 * (表示名 + サインアウト)を開く、Web版と同じ挙動。
 *
 * [不具合修正・2026-08-04] 以前ここにあった接続状態アイコン(ConnectionStatusIcon、
 * ルームIDの頭文字を丸の中に表示するもの)は、HeaderRow(PTTApp.kt)側で
 * 組織/ルーム名+接続状態のドット+テキストを直接ヘッダーに並べる方式へ変更した際に
 * 廃止した(Web版AppHeader.vue・iOS版ContentView.swift 6訂の移植。
 * 詳細はbrushup-plan.md参照)。
 */
package co.ubunifu.pttandroid.ui

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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.ubunifu.pttandroid.R
import co.ubunifu.pttandroid.ui.theme.PTTColors
import coil.compose.SubcomposeAsyncImage

private val Mono = FontFamily.Monospace
private val IconBadgeSize = 28.dp

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
    ProfileAvatar(photoUrl, size = IconBadgeSize)
}

/**
 * [モバイルUI再編・2026-08-04] 設定タブのプロフィール行(iOS版profileAvatar、40dp)でも
 * 同じアバター描画ロジックを再利用できるよう、サイズを引数化して公開した。
 * 元々のLoginStatusIcon(ヘッダー用、28dp)からはAvatarContent経由でそのまま使う。
 */
@Composable
fun ProfileAvatar(photoUrl: String?, size: androidx.compose.ui.unit.Dp = IconBadgeSize) {
    if (photoUrl.isNullOrBlank()) {
        PersonPlaceholder(size)
        return
    }
    SubcomposeAsyncImage(
        model = photoUrl,
        contentDescription = null,
        modifier = Modifier
            .size(size)
            .clip(CircleShape),
        error = { PersonPlaceholder(size) },
        loading = { PersonPlaceholder(size) },
    )
}

@Composable
private fun PersonPlaceholder(containerSize: androidx.compose.ui.unit.Dp = IconBadgeSize) {
    Icon(
        painter = painterResource(R.drawable.ic_person),
        contentDescription = null,
        tint = PTTColors.Muted,
        modifier = Modifier.size(containerSize * 0.5f),
    )
}

/** role=imgのアクセシビリティラベルに相当する簡易ヘルパー(TalkBack用のcontentDescription付与)。 */
private fun Modifier.semanticsLabel(label: String): Modifier =
    this.semantics { contentDescription = label }
