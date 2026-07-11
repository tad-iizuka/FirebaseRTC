# PTT Design System v1.0

既存実装（`ptt-client/public/index.html`, `admin-dashboard/public/index.html`,
`dev-tools/admin-dashboard.html`）で既に一貫して使われているダークテーマ・
モノスペースUIを正式なトークンとして固定し、iOS/Android/管理画面/今後追加する
画面すべてで再利用できる形に整理したもの。

現状、iOS版(`ContentView.swift`)・Android版(`PTTApp.kt`)は同じ配色を
それぞれ独立したハードコード値として持っている（例: iOSは
`Color(red: 0.24, green: 0.86, blue: 0.52)`、Androidは`Color(0xFF3DDC84)`）。
これは同じ `--live: #3ddc84` の再実装であり、本ドキュメントのトークン表を
「正」として今後は差分レビューできるようにする。

---

## 1. カラートークン

| トークン名 | HEX | 用途 | Web(CSS var) | iOS(概算RGB) | Android(ARGB) |
|---|---|---|---|---|---|
| `color/bg` | `#0d1210` | 画面背景（最も暗い層） | `--bg` | `(0.05, 0.07, 0.06)` | `0xFF0D1210` |
| `color/panel` | `#141b18` | カード・パネル面 | `--panel` | — | — |
| `color/line` | `#263129` | ボーダー・区切り線 | `--line` | `gray.opacity(0.4)`相当 | `0xFF263129` |
| `color/text` | `#d8e4dd` | 主要テキスト | `--text` | `(0.85, 0.89, 0.86)` | (Material既定onSurface) |
| `color/muted` | `#6f8079` | 補助テキスト・ラベル・非アクティブ状態 | `--muted` | `.gray` | `0xFF6F8079` |
| `color/accent` | `#ff7a3c` | プライマリアクション（送信・作成・PTT active） | `--accent` | `.orange` | `0xFFFF7A3C` |
| `color/accent-dim` | `#5c3520` | accentのホバー/押下背景 | `--accent-dim` | — | — |
| `color/live` | `#3ddc84` | 接続中・送話中・成功状態 | `--live` | `(0.24, 0.86, 0.52)` | `0xFF3DDC84` |
| `color/warning` | `#f3b833` | 再接続中など「注意だが致命的でない」状態 | *(未定義・要追加)* | `(0.95, 0.72, 0.2)` | `0xFFF3B833` |
| `color/danger` | `#ff5c5c` | エラー・BAN・録音中バッジ | `--danger` | `(1.0, 0.36, 0.36)` | `0xFFFF5C5C` |

**運用ルール**
- `warning` はAndroid版の `StatusRow`（再接続中）でのみ暗黙的に使われ、Web版CSSには未定義。次回Web側改修時に `--warning: #f3b833` を追加し、3プラットフォームで揃えること。
- `live` は「Androidアプリのブランドグリーン（`ic_launcher_background.xml`の`#3DDC84`）」と完全一致させている。ロゴ色=ステータス色として統一済みなので、変更時は両方に影響することに注意。
- accent/danger/live 以外の新規状態色を追加する場合は、既存の彩度・明度レンジ（HSL Lightness 55–70%程度、Saturation高め）に合わせる。

---

## 2. タイポグラフィ

**フォントファミリー: モノスペース固定**
このアプリ全体は「ログ・ID・招待コード・トークン」など英数字の可読性を優先する
運用ツール的UIのため、装飾フォントを使わずモノスペースで統一する。

| プラットフォーム | 指定 |
|---|---|
| Web | `"SF Mono", "Menlo", "Consolas", monospace` |
| iOS | `.system(size:, design: .monospaced)` |
| Android | `FontFamily.Monospace` |

**タイプスケール**

| 用途 | サイズ | 装飾 |
|---|---|---|
| セクションラベル（例: "PTT CLIENT", "参加者(緑=送話中)"） | 10–11px | uppercase, letter-spacing 0.08–0.12em, `color/muted` |
| ログ・stats本文 | 10–11px | `color/muted`, line-height 1.6 |
| ボタン文言 | 12px | uppercase, letter-spacing 0.08em |
| 本文・チャット・参加者名 | 12–13px | 通常 |
| 入力フィールド | 14–16px | Web版はiOS自動ズーム防止のため16px |
| 招待コード表示 | 18px | bold, `color/accent` |
| PTTボタンラベル | 12–13px | uppercase |

---

## 3. スペーシング・角丸・境界線

- **角丸は最小限**: ボタン・入力欄 = 2px、パネル = 4px、チップ = 999px（完全な丸）。
  装飾的な丸みを避け、「業務ツール」的な硬質さを保つ。
- **境界線 > 影**: elevationはドロップシャドウでなく`1px solid var(--line)`で表現する。
  例外は「ライブ状態のグロー」（`box-shadow: 0 0 6px var(--live)`など、状態を強調する場合のみ）。
- **セクション内パディング**: 14–18px
- **要素間ギャップ**: 6–10px
- **破線ボーダー**: 招待コードboxなど「一時的・コピー用の情報」を示す時のみ `dashed` を使う。

---

## 4. コンポーネント仕様

### 4.1 ボタン
| バリアント | スタイル | 用途 |
|---|---|---|
| Primary | `border: 1px solid accent`, `color: accent`, hover bg `accent-dim` | ルーム作成、送信、サインイン |
| Secondary | `border: 1px solid line`, `color: muted` | 退出、削除、キャンセル |
| Danger | `color: danger`（テキストのみ、またはBAN確認ダイアログのみ塗り） | BAN実行 |
| Disabled | `opacity: 0.3–0.35` | 非同期処理中・条件未達 |

### 4.2 ステータスドット
7px円。`muted`(未接続) / `live`(接続中、グロー付き) / `danger`(エラー) の3状態。
Android版の再接続中は`warning`色を追加で使用（要Web側統一）。

### 4.3 PTTボタン（コア・コンポーネント）
- 円形、直径 140–160px（レスポンシブでモバイルは大きめ160px、デスクトップ140px）
- 非アクティブ: `radial-gradient(circle at 35% 30%, #1c2620, #10160f)`、境界線`line`
- アクティブ（送話中）: 境界線`accent`、`scale(0.97)`、`box-shadow: 0 0 24px -4px accent`
- 他者が発話ロックを保持している間はdisabled + ラベルを「{名前}が送話中」に差し替え

### 4.4 チップ（参加者・タグ）
- `border-radius: 999px`, `border: 1px solid line`, `color: muted`
- 送話中(unmuted)時のみ `border-color/color: live`
- チップ内アクションはテキストリンク風（`underline`, `font-size: 10px`）、danger系は`color: danger`

### 4.5 バッジ
- `録音中` = danger border/color
- `発話中: {uid}` = accent border/color
- 常に `border-radius: 999px`, `font-size: 10px`

### 4.6 入力フィールド
- `background: bg`, `border: 1px solid line`, focus時 `border-color: accent`
- placeholderは`muted`色、ラベルはセクションラベル規則に準拠

### 4.7 招待コードBox
- 破線ボーダー`accent`、内部に「コード(18px, accent)」+「roomId(muted)」

### 4.8 ログ/統計パネル
- 固定高（max-height 130–180px）、スクロール可、`muted`色、モノスペース
- 1行=1イベント、タイムスタンプ`[HH:MM:SS]`をプレフィックス

### 4.9 チャットリスト
- 自分の発言のみ`live`色、それ以外は`text`色
- 送信ボタンは空文字時disabled

---

## 5. アクセシビリティ・実装上の注意

- コントラスト: `text` (#d8e4dd) on `bg` (#0d1210) はAA基準を十分満たす。`muted` (#6f8079) on `bg` はAA未達の可能性があるため、本文には使わずラベル・補助情報のみに限定する現行方針を継続する。
- タップ領域: PTTボタンはモバイルで最低140px角を確保済み。チップ内のBAN/通報リンクは10px文字で領域が狭いため、モバイル実機での誤タップ率を今後計測すべき（未実装の改善項目）。
- ダークテーマ固定: 現状ライトモード切替は3プラットフォームとも未実装。今後対応する場合、`bg`/`panel`/`text`系トークンのみを反転させ、`accent`/`live`/`danger`は据え置く方針を推奨（ブランド色の一貫性維持のため）。

---

## 6. 今後のアクション項目

1. Web版CSSに `--warning: #f3b833` を追加し、Android版と表記を統一する。
2. iOS/Android双方でハードコードされている色定数を、本表のトークン名で一元管理できる形（iOS: `Color+Tokens.swift` の追加、Android: `Theme`内の`Color`定義への集約）にリファクタリングする。
3. `admin-dashboard` と `ptt-client` で完全一致しているCSSを共有スタイルシート（例: `shared/design-tokens.css`）へ切り出し、3つのHTMLファイルでの重複定義を解消する。
