/**
 * ChatAvatar.kt
 *
 * [チャットUI刷新・五十六訂/五十七訂のAndroid移植]
 * Web版(ptt-client/src/components/ChatAvatar.vue + src/lib/avatarColor.ts)・
 * iOS版(ChatAvatarView.swift)の移植。表示の優先順位は3段階:
 *   1. photoUrl があれば丸型の写真
 *   2. role == "guest" ならベクターアイコン(顔写真を設定できないため、頭文字よりも
 *      「ゲストである」ことが一目でわかる表現にする)。material-icons-extendedへの
 *      依存を増やさない方針(PTTStatusIcons.kt参照)のため、既存のR.drawable.ic_person
 *      (LoginStatusIcon等のプレースホルダーと同じアセット。iOS版のSF Symbols
 *      `person.fill`に相当)を再利用する
 *   3. それ以外は頭文字 + uidから決定的に生成した色
 * プロフィール写真機能は本ファイル作成時点では未実装のため、実運用ではしばらく
 * 常に2/3のパスを通る。photoUrl側の分岐は将来の機能追加時にこのComposableを
 * 変更せずに済むよう先に用意している。
 */
package co.ubunifu.pttandroid.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.ubunifu.pttandroid.R
import co.ubunifu.pttandroid.ui.theme.PTTColors
import coil.compose.SubcomposeAsyncImage

private val Mono = FontFamily.Monospace

@Composable
fun ChatAvatarView(
    uid: String,
    displayName: String,
    role: String?,
    photoUrl: String?,
    size: Dp = 34.dp,
) {
    val isGuest = role == "guest"

    if (!photoUrl.isNullOrBlank()) {
        SubcomposeAsyncImage(
            model = photoUrl,
            contentDescription = displayName,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(size).clip(CircleShape),
            // 読み込み中/失敗時は、photoUrlが無い場合と同じ2/3のフォールバック表示にする
            error = { ChatFallbackAvatar(uid, displayName, isGuest, size) },
            loading = { ChatFallbackAvatar(uid, displayName, isGuest, size) },
        )
    } else {
        ChatFallbackAvatar(uid, displayName, isGuest, size)
    }
}

@Composable
private fun ChatFallbackAvatar(uid: String, displayName: String, isGuest: Boolean, size: Dp) {
    if (isGuest) {
        val label = stringResource(R.string.room_guest_badge)
        Box(
            modifier = Modifier
                .size(size)
                .clip(CircleShape)
                .background(PTTColors.Warning.copy(alpha = 0.15f))
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_person),
                contentDescription = null,
                tint = PTTColors.Warning,
                modifier = Modifier.size(size * 0.5f),
            )
        }
    } else {
        val palette = ChatAvatarPalette.colorsForUid(uid)
        Box(
            modifier = Modifier
                .size(size)
                .clip(CircleShape)
                .background(palette.background)
                .semantics { contentDescription = displayName },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                ChatAvatarPalette.initialForDisplayName(displayName),
                fontFamily = Mono,
                fontSize = (size.value * 0.4f).sp,
                color = palette.foreground,
            )
        }
    }
}

/**
 * [avatarColor.ts / iOS版ChatAvatarPaletteの移植] 生成アバターの背景色をuidから
 * 決定的に選ぶ。同一人物は常にセッションをまたいでも同じ色になる。
 *
 * JS版と同じ32bit整数ハッシュ((hash << 5) - hash + charCode; hash |= 0)を、
 * KotlinのIntの標準演算(2の補数オーバーフローで暗黙に折り返す。JavaのIntと同じ)で
 * そのまま再現しているため、Swift版のような特別なオーバーフロー演算子は不要。
 * 添字算出は`((hash % size) + size) % size`とし、abs()を使わない。
 * (abs(Int.MIN_VALUE)はInt.MIN_VALUEのまま、つまり依然として負の値になり、
 * 負の値を配列添字にできず理論上クラッシュしうる。極めて低確率だが、
 * このやり方ならその場合でも常に0..size-1に収まる)
 */
object ChatAvatarPalette {
    data class Colors(val background: Color, val foreground: Color)

    private val palette: List<Colors> by lazy {
        listOf(
            Colors(PTTColors.Accent.copy(alpha = 0.15f), PTTColors.Accent),
            Colors(PTTColors.Live.copy(alpha = 0.15f), PTTColors.Live),
            Colors(PTTColors.Warning.copy(alpha = 0.15f), PTTColors.Warning),
            Colors(PTTColors.Danger.copy(alpha = 0.15f), PTTColors.Danger),
            Colors(PTTColors.Panel, PTTColors.Text),
        )
    }

    fun colorsForUid(uid: String): Colors {
        var hash = 0
        for (ch in uid) {
            hash = (hash shl 5) - hash + ch.code
        }
        val index = ((hash % palette.size) + palette.size) % palette.size
        return palette[index]
    }

    fun initialForDisplayName(displayName: String): String {
        val trimmed = displayName.trim()
        if (trimmed.isEmpty()) return "?"
        return trimmed.first().uppercaseChar().toString()
    }
}
