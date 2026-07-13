# デザインシステム適用パッチ手順

新規作成した3ファイル（`shared/design-tokens.css` / `Color+Tokens.swift` /
`PTTColors.kt`）を、既存の5ファイルに適用するための具体的な変更点。
各ファイルは巨大なため全文差し替えではなく、該当箇所のみのdiff形式で示す。

---

## 1. `ptt-client/public/index.html`

### 1-1. `<head>` に共有トークンCSSを読み込む
`<title>PTT Client</title>` の直後、既存の `<script src=".../livekit-client...">` の前に追加:

```html
<link rel="stylesheet" href="../../shared/design-tokens.css">
```

### 1-2. `<style>` 内の `:root { ... }` ブロックを削除
以下をまるごと削除（`shared/design-tokens.css` に移管済みのため）:

```css
  :root {
    --bg: #0d1210; --panel: #141b18; --line: #263129; --text: #d8e4dd;
    --muted: #6f8079; --accent: #ff7a3c; --accent-dim: #5c3520;
    --live: #3ddc84; --danger: #ff5c5c; --mono: "SF Mono", "Menlo", "Consolas", monospace;
  }
```

### 1-3. 再接続中インジケーターのCSSを追加
`.dot.error { background: var(--danger); }` の直後に追加:

```css
  .dot.reconnecting { background: var(--warning); box-shadow: 0 0 6px var(--warning); }
```

### 1-4. JS側で再接続状態を反映する
`RoomEvent.ConnectionStateChanged` ハンドラを以下のように変更（Android/iOS版は
既に `Reconnecting` を扱っているため、Web版だけ未対応だった差分を埋める）:

**変更前:**
```js
.on(RoomEvent.ConnectionStateChanged, (state) => {
      log(`接続状態: ${state}`);
      if (state === ConnectionState.Disconnected && !manuallyDisconnected) {
        setStatus('error', '切断されました');
        roomConnected = false;
        stopTalkHeartbeat();
        currentTalkerUid = null;
        updatePttButtonState();
        participants.clear();
        renderParticipants();
      }
    })
```

**変更後:**
```js
.on(RoomEvent.ConnectionStateChanged, (state) => {
      log(`接続状態: ${state}`);
      if (state === ConnectionState.Reconnecting) {
        setStatus('reconnecting', '再接続中...');
      } else if (state === ConnectionState.Connected && roomConnected) {
        setStatus('connected', `接続中 (room=${currentRoomId})`);
      } else if (state === ConnectionState.Disconnected && !manuallyDisconnected) {
        setStatus('error', '切断されました');
        roomConnected = false;
        stopTalkHeartbeat();
        currentTalkerUid = null;
        updatePttButtonState();
        participants.clear();
        renderParticipants();
      }
    })
```

---

## 2. `admin-dashboard/public/index.html`

`ptt-client/public/index.html` と `:root` ブロックが完全一致しているため、
手順は 1-1・1-2 と同じ（再接続状態や3-4のPTT固有JSは無いため不要）。
パスのみ異なる:

```html
<link rel="stylesheet" href="../../shared/design-tokens.css">
```

`:root { ... }` ブロックの削除内容は 1-2 と同一。

---

## 3. `dev-tools/admin-dashboard.html`

同じく `:root` ブロックが完全一致。このファイルは `ptt-client/public/` や
`admin-dashboard/public/` より1階層浅い(`dev-tools/`直下)ため、パスが異なる:

```html
<link rel="stylesheet" href="../shared/design-tokens.css">
```

`:root { ... }` ブロックの削除内容は 1-2 と同一。

---

## 4. `ptt-ios/ptt-ios/ContentView.swift`

`Color+Tokens.swift` をプロジェクトに追加した上で、以下の対応表通りに
リテラルをトークンへ置換する（`Cmd+F`で全置換可能な単純な文字列置換）。

| 置換前（リテラル） | 置換後（トークン） | 出現箇所の例 |
|---|---|---|
| `Color(red: 0.05, green: 0.07, blue: 0.06)` | `.pttBackground` | `body.background(...)` |
| `Color(red: 0.85, green: 0.89, blue: 0.86)` | `.pttText` | `body.foregroundColor(...)` |
| `.orange`（ボタン・招待コード・accentとして使用箇所） | `.pttAccent` | authSection, createRoomBtn, inviteBox 等 |
| `.gray`（ラベル・muted状態として使用箇所） | `.pttMuted` | header, statusText, ログ, 参加者名(muted) 等 |
| `Color(red: 1.0, green: 0.36, blue: 0.36)` | `.pttDanger` | banNotice, errorMessage表示, BANボタン, statusColor(.error) |
| `Color(red: 0.24, green: 0.86, blue: 0.52)` | `.pttLive` | statusColor(.connected), 参加者名(unmuted), チャット自分の発言 |
| `Color(red: 0.95, green: 0.72, blue: 0.2)` | `.pttWarning` | statusColor(.reconnecting) |
| `Color.gray.opacity(0.4)` / `Color.gray.opacity(0.5)` | `.pttLine.opacity(0.8)` 相当、または `.pttLine` | secondaryボタン・PTTボタン非アクティブ時の境界線 |
| `Color.black.opacity(0.3)` / `Color.black.opacity(0.15)` | `.pttPanel.opacity(0.6)` 目安（微調整可） | 入力欄・チャットリストの背景 |

**注意**: `.orange` と `.gray` はSwiftUI標準色のため、意図せず別用途（例えば
将来的にシステムの`.orange`を使いたいケース）と衝突しないよう、置換は
「PTTデザインシステムの意味で使っている箇所」に限定して行うこと
（本ファイルでは全て該当するはずだが、念のため置換後にビルド＋目視確認する）。

---

## 5. `ptt-android/app/src/main/java/co/ubunifu/pttandroid/ui/PTTApp.kt`

### 5-1. import追加
```kotlin
import co.ubunifu.pttandroid.ui.theme.PTTColors
```

### 5-2. ファイル冒頭のローカル色定義を削除
```kotlin
private val Live = Color(0xFF3DDC84)
private val Danger = Color(0xFFFF5C5C)
private val Accent = Color(0xFFFF7A3C)
private val Muted = Color(0xFF6F8079)
private val Mono = FontFamily.Monospace
```
→ `Mono` の行だけ残し、色4行は削除（`Mono`はタイポグラフィトークンでありPTTColorsの対象外のため据え置き）。

### 5-3. ファイル内の全参照を置換
`Live` → `PTTColors.Live`、`Danger` → `PTTColors.Danger`、
`Accent` → `PTTColors.Accent`、`Muted` → `PTTColors.Muted`
（`StatusRow`のボタン色、`HeaderRow`のサインアウトテキスト色、
`ParticipantsSection`のBANテキスト色、`AlertDialog`のconfirmButton色など全箇所）。

### 5-4. `StatusRow` 内の再接続色をトークン化
**変更前:**
```kotlin
is ConnectionStatus.Reconnecting -> Color(0xFFF3B833) to "再接続中... (room=${status.room})"
```

**変更後:**
```kotlin
is ConnectionStatus.Reconnecting -> PTTColors.Warning to "再接続中... (room=${status.room})"
```

---

## 適用後の確認チェックリスト

- [ ] `shared/design-tokens.css` を3つのHTMLがそれぞれ正しい相対パスで読み込めている
- [ ] 3つのHTMLの見た目（配色）が変更前と完全に同一である（トークンの値自体は変えていないため差分ゼロのはず）
- [ ] Web版でLiveKit切断→再接続をエミュレートし、ドットが`--warning`色で光ることを確認
- [ ] iOS/Android版をビルドし、色の見た目に差分が無いことを確認（リファクタリングのみで値は不変のため）
- [ ] `--warning` / `PTTColors.Warning` / `.pttWarning` の3値が `#f3b833` で一致している
