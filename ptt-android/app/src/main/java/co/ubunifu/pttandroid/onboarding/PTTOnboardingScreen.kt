/**
 * PTTOnboardingScreen.kt
 *
 * [オンボーディング]
 * Web版(ptt-client/src/components/OnboardingFlow.vue)・iOS版(PTTOnboardingView.swift)と
 * 同じ4枚構成のスワイプ形式イントロ画面。Compose Foundation標準のHorizontalPagerで
 * ページングし、下部に自前のドットインジケーターと戻る/次へ(最後は「はじめる」)ボタンを
 * 配置する。配色はPTTColorsのトークンをそのまま使い、Web版・iOS版と同じ文言・スライド
 * 構成にして3プラットフォーム間の体験を揃えている。
 *
 * [アイコンについて] Web版はlucideアイコン、iOS版はSF Symbolsを使っているが、
 * Android側で同等のピクトグラムを使うには `androidx.compose.material:material-icons-extended`
 * への依存追加が必要になる(標準の material-icons-core には Mic 以外の該当アイコンが
 * 含まれない)。本プロジェクトの build.gradle.kts には現状その依存が無く、新規に依存を
 * 増やすほどのことでもないため、システム絵文字フォントで代替している(追加の依存なしで
 * 3プラットフォームと近い視覚効果が得られる)。
 *
 * [注意] rememberPagerState(pageCount = { ... }) はCompose Foundation 1.5.0以降の
 * 安定版API。本プロジェクトのcompose-bom(2024.09.03)は対応するfoundationバージョンで
 * 安定版として利用できるが、念のため@OptIn(ExperimentalFoundationApi::class)を付与している
 * (未実験化バージョンでも無害な指定)。
 */
package co.ubunifu.pttandroid.onboarding

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.ubunifu.pttandroid.ui.theme.PTTColors
import kotlinx.coroutines.launch

private val Mono = FontFamily.Monospace

private data class OnboardingSlide(
    val emoji: String,
    val title: String,
    val description: String,
)

private val onboardingSlides = listOf(
    OnboardingSlide(
        emoji = "\uD83D\uDCE1", // 📡
        title = "PTT Client へようこそ",
        description = "トランシーバーのように、押している間だけ声が届くシンプルな音声チャットです。",
    ),
    OnboardingSlide(
        emoji = "\uD83D\uDEAA", // 🚪
        title = "ルームを作成・参加",
        description = "ルームは招待制です。自分でルームを作成するか、招待コードを受け取って参加しましょう。",
    ),
    OnboardingSlide(
        emoji = "\uD83C\uDF99", // 🎙
        title = "ボタンを押して話す",
        description = "中央のPTTボタンを押している間だけ音声が送信されます。誰かが話している間は自動的に送話が待機状態になります。",
    ),
    OnboardingSlide(
        emoji = "\uD83D\uDCAC", // 💬
        title = "チャットと参加者管理",
        description = "テキストチャットや参加者一覧に加え、モデレーター向けのBAN・通報機能も使えます。",
    ),
)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PTTOnboardingScreen(onComplete: () -> Unit) {
    val pagerState = rememberPagerState(pageCount = { onboardingSlides.size })
    val scope = rememberCoroutineScope()
    val isFirst by remember { derivedStateOf { pagerState.currentPage == 0 } }
    val isLast by remember { derivedStateOf { pagerState.currentPage == onboardingSlides.size - 1 } }

    Column(Modifier.fillMaxSize().background(PTTColors.Background)) {
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.End) {
            Text(
                "スキップ",
                fontFamily = Mono,
                fontSize = 11.sp,
                color = PTTColors.Muted,
                modifier = Modifier.pointerInput(Unit) {
                    detectTapGestures(onTap = { onComplete() })
                },
            )
        }

        HorizontalPager(
            state = pagerState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) { page ->
            SlideContent(onboardingSlides[page])
        }

        Row(
            Modifier.fillMaxWidth().padding(bottom = 14.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            onboardingSlides.indices.forEach { i ->
                val active = i == pagerState.currentPage
                Box(
                    Modifier
                        .padding(horizontal = 3.dp)
                        .height(6.dp)
                        .width(if (active) 20.dp else 6.dp)
                        .clip(CircleShape)
                        .background(if (active) PTTColors.Accent else PTTColors.Line)
                )
            }
        }

        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(
                onClick = { scope.launch { pagerState.animateScrollToPage(pagerState.currentPage - 1) } },
                enabled = !isFirst,
                modifier = Modifier.weight(1f),
            ) {
                Text("戻る", fontFamily = Mono)
            }
            Button(
                onClick = {
                    if (isLast) {
                        onComplete()
                    } else {
                        scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                    }
                },
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = PTTColors.Accent),
            ) {
                Text(if (isLast) "はじめる" else "次へ", fontFamily = Mono)
            }
        }
    }
}

@Composable
private fun SlideContent(slide: OnboardingSlide) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(slide.emoji, fontSize = 44.sp)
        Spacer(Modifier.height(20.dp))
        Text(
            slide.title,
            fontFamily = Mono,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            color = PTTColors.Text,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            slide.description,
            fontFamily = Mono,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
            color = PTTColors.Muted,
        )
    }
}

