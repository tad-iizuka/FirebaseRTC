/**
 * PTTColors.kt
 *
 * [デザインシステム統一]
 * ptt-design-system.md の「1. カラートークン」表をComposeのColor定数として
 * 一元管理する。以前は PTTApp.kt 内に private val Live/Danger/Accent/Muted が
 * 個別に定義されており、再接続中を表す警告色(0xFFF3B833)は StatusRow の中に
 * リテラルのまま埋め込まれていた(トークン化されていなかったため、Web版に
 * 同じ色が存在しないことに誰も気づけなかった)。以後、色を使う箇所は必ず
 * この PTTColors を参照すること。値は shared/design-tokens.css /
 * ptt-ios/ptt-ios/Color+Tokens.swift と同期させること(変更時は3箇所セットで直す)。
 */
package co.ubunifu.pttandroid.ui.theme

import androidx.compose.ui.graphics.Color

object PTTColors {
    /** #0d1210 — 画面背景 */
    val Background = Color(0xFF0D1210)
    /** #141b18 — カード/パネル面 */
    val Panel = Color(0xFF141B18)
    /** #263129 — ボーダー・区切り線 */
    val Line = Color(0xFF263129)
    /** #d8e4dd — 主要テキスト */
    val Text = Color(0xFFD8E4DD)
    /** #6f8079 — 補助テキスト・ラベル・非アクティブ状態 */
    val Muted = Color(0xFF6F8079)
    /** #ff7a3c — プライマリアクション(送信・作成・PTT active) */
    val Accent = Color(0xFFFF7A3C)
    /** #5c3520 — accentのホバー/押下背景 */
    val AccentDim = Color(0xFF5C3520)
    /** #3ddc84 — 接続中・送話中・成功状態 */
    val Live = Color(0xFF3DDC84)
    /** #f3b833 — 再接続中など「注意だが致命的でない」状態 */
    val Warning = Color(0xFFF3B833)
    /** #ff5c5c — エラー・BAN・録音中 */
    val Danger = Color(0xFFFF5C5C)
}
