//
//  Color+Tokens.swift
//  ptt-ios
//
//  [デザインシステム統一]
//  ptt-design-system.md の「1. カラートークン」表をSwiftUIのColor拡張として定義する。
//  以前は ContentView.swift 内の各所で `Color(red: 0.24, green: 0.86, blue: 0.52)` の
//  ように同じ色をリテラルで再実装しており、Web版(--live等のCSS変数)や
//  Android版(PTTColors.kt)との差分に気づけなかった。以後、色を使う箇所は必ず
//  このファイルのトークンを参照すること。値は shared/design-tokens.css /
//  PTTColors.kt と同期させること(変更時は3箇所セットで直す)。
//
//  [2024-xx-xx 修正]
//  `.background(...)` / `.fill(...)` / `.stroke(...)` など、引数型が
//  `some ShapeStyle`(ジェネリック)なAPIでは、`Color`への拡張だけでは
//  `.pttBackground` のようなドット構文で推論されない。
//  そのため以下の2段構えにする:
//    1) `Color` 自体への拡張 … `Color.pttBackground` のように明示的に
//       `Color`型が要求される場所(型注釈、Color同士の演算など)で使う。
//    2) `ShapeStyle where Self == Color` への拡張 … `.background(.pttBackground)`
//       `.fill(.pttLive)` `.foregroundStyle(.pttText)` のように
//       ジェネリックな `ShapeStyle`/`View`引数の文脈で `.トークン名` を使う。
//       (Appleの `.red` `.blue` などが両方の文脈で動くのもこの実装パターンによる)
//  値の本体は1)のColor拡張にのみ持たせ、2)はそれを参照するだけにして
//  値の二重管理を避けている。

import SwiftUI

// MARK: - 1. Color本体の定義(単一の情報源)

extension Color {
    /// #0d1210 — 画面背景
    static let pttBackground = Color(red: 0.05, green: 0.07, blue: 0.06)
    /// #141b18 — カード/パネル面
    static let pttPanel = Color(red: 0.078, green: 0.106, blue: 0.094)
    /// #263129 — ボーダー・区切り線
    static let pttLine = Color(red: 0.149, green: 0.192, blue: 0.161)
    /// #d8e4dd — 主要テキスト
    static let pttText = Color(red: 0.85, green: 0.89, blue: 0.86)
    /// #6f8079 — 補助テキスト・ラベル・非アクティブ状態
    static let pttMuted = Color(red: 0.435, green: 0.502, blue: 0.475)
    /// #ff7a3c — プライマリアクション(送信・作成・PTT active)
    static let pttAccent = Color(red: 1.0, green: 0.478, blue: 0.235)
    /// #5c3520 — accentのホバー/押下背景
    static let pttAccentDim = Color(red: 0.361, green: 0.208, blue: 0.125)
    /// #3ddc84 — 接続中・送話中・成功状態
    static let pttLive = Color(red: 0.24, green: 0.86, blue: 0.52)
    /// #f3b833 — 再接続中など「注意だが致命的でない」状態
    static let pttWarning = Color(red: 0.953, green: 0.722, blue: 0.2)
    /// #ff5c5c — エラー・BAN・録音中
    static let pttDanger = Color(red: 1.0, green: 0.36, blue: 0.36)
}

// MARK: - 2. ShapeStyleとしての橋渡し(.background/.fill/.stroke等で使えるように)

extension ShapeStyle where Self == Color {
    static var pttBackground: Color { .pttBackground }
    static var pttPanel: Color { .pttPanel }
    static var pttLine: Color { .pttLine }
    static var pttText: Color { .pttText }
    static var pttMuted: Color { .pttMuted }
    static var pttAccent: Color { .pttAccent }
    static var pttAccentDim: Color { .pttAccentDim }
    static var pttLive: Color { .pttLive }
    static var pttWarning: Color { .pttWarning }
    static var pttDanger: Color { .pttDanger }
}
