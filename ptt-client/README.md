# PTTClient (Web) — Vue 3 + TypeScript + Pinia + Tailwind + shadcn-vue

`ptt-client/public/index.html`(no-frameworkのvanilla JS実装)を置き換える、Phase 7に向けた
アーキテクチャ刷新版です。見た目(ダーク+monospace+オレンジアクセントのターミナル/CB無線調)は
意図的に変更していません。Phase 7で正式なデザインシステムを策定する際に、ここで用意した
Tailwind/shadcn-vueのトークン層(`src/style.css` / `tailwind.config.ts`)を書き換える想定です。

## スタック

- **Vue 3** (`<script setup>` + Composition API) / **TypeScript**
- **Pinia** — 状態管理
- **Vue Router** — 画面遷移(`/` = ルーム選択, `/room/:roomId` = 入室後)
- **Tailwind CSS** + **shadcn-vue** 互換のトークン設計(`components.json`済み。以後は
  `npm run shadcn:add <component>` で公式コンポーネントを追加できます)
- **@lucide/vue** — アイコン(`lucide-vue-next` は非推奨のため不使用。
  [shadcn-vue#1824](https://github.com/unovue/shadcn-vue/issues/1824) 参照)
- **VueUse** — `useStorage` 等
- **Vite** / **vitest** / **ESLint (flat config, typescript-eslint)** / **Prettier**

## ディレクトリ構成

```
src/
  lib/         firebase初期化 / authedFetch相当のAPIクライアント / cn()ユーティリティ
  types/api.ts token-serverのレスポンス型一式
  stores/      Piniaストア (auth / room / ban / chat / connection / savedRooms / settings)
  components/  UIコンポーネント。components/ui/ が shadcn-vue のプリミティブ置き場
  views/       AuthView / RoomSelectView / RoomView
  router/      認証復元待ちを行うだけの薄いガード
```

### 状態管理の分割方針(iOS/Android版との対応)

このリポジトリのiOS版(`PTTConnectionManager.swift`等)・Android版と同じ粒度でストアを分けています。

| Pinia store | 相当するもの |
|---|---|
| `stores/auth.ts` | `PTTAuthManager` |
| `stores/room.ts` | `PTTRoomManager`(ルーム作成/参加) |
| `stores/ban.ts` | `PTTBanStore`(ロール取得・BAN即時検知・BAN実行) |
| `stores/chat.ts` | `PTTChatStore` |
| `stores/connection.ts` | `PTTConnectionManager`(LiveKit接続・PTT・発話ロックheartbeat・トークン自動更新) |
| `stores/savedRooms.ts` | `PTTSavedRoomsStore`(uidごとのlocalStorage履歴) |

## セットアップ

```bash
cd ptt-client
npm install
npm run dev
```

`.env.example` を `.env` にコピーして値を上書きすれば別のFirebaseプロジェクトを指せますが、
未設定でも `src/lib/firebase.ts` 内のデフォルト値(既存の公開設定と同じ)にフォールバックします。

### 主要スクリプト

```bash
npm run dev       # 開発サーバー
npm run build     # 型チェック(vue-tsc) + 本番ビルド → dist/
npm run test      # vitest
npm run lint      # ESLint
npm run format    # Prettier
npm run shadcn:add <component>   # shadcn-vueの公式コンポーネントを追加
```

`npm install` → `npm run lint` → `npm run test` → `npm run build` まで通ることをこの環境で確認済みです。

## `firebase.json` / CI に必要な変更

旧実装はビルドレスで `ptt-client/public` を直接Hostingへデプロイしていましたが、
本リニューアルではビルド成果物(`ptt-client/dist`)を配信する形に変わります。

**`firebase.json`** の `hosting[0].public` を書き換えてください:

```diff
  {
    "target": "client",
-   "public": "ptt-client/public",
+   "public": "ptt-client/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
  }
```

**`.github/workflows/web-deploy.yml`** はNode.js環境の用意とビルドステップの追加が必要です
(現行の `lint` ジョブが `html-validate` を直接叩いている箇所は不要になります):

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "20"
    cache: "npm"
    cache-dependency-path: ptt-client/package-lock.json
- run: npm ci
  working-directory: ptt-client
- run: npm run build
  working-directory: ptt-client
```

その後の `FirebaseExtended/action-hosting-deploy` ステップ自体は変更不要です
(`firebase.json` 側の `public` が `dist` を指すため)。

## 意図的に簡略化した箇所(次のイテレーションで対応)

- **BAN確認ダイアログ**は `ConfirmDialog.vue` を自前実装しています。フォーカストラップ等の
  アクセシビリティは最低限です。今後 shadcn-vue の `Dialog`(reka-ui製、`npm run shadcn:add dialog`)
  に置き換えることを推奨します。
- **通報理由の入力**は旧実装と同様 `window.prompt()` を暫定的に使っています。
  Phase 7の「エラーメッセージのユーザー向け言い換え」と合わせて、shadcn-vueの
  `Dialog` + フォームに置き換えるとよいです。
- **音声統計(RTP実測値)ポーリング**は旧 `public/index.html` にあった `updateStats()` 相当の
  機能を今回は移植していません。必要であれば `stores/connection.ts` に
  `track.getRTCStatsReport()` を使ったポーリングを追加してください。
- **admin-dashboard** は今回のスコープ外です(次のフェーズで着手する想定)。

## 動作確認チェックリスト

- [ ] `npm run build` が通る(vue-tsc + vite build)
- [ ] `npm run lint` がエラー0
- [ ] `npm run test` が通る
- [ ] Googleサインイン → ルーム作成 → 招待コード表示
- [ ] 別ブラウザ/シークレットウィンドウで招待コード参加 → PTTボタンで送話ロックが機能する
- [ ] owner/moderatorのみBANボタンが見える、BAN実行後に対象が即座に切断される
- [ ] チャット送受信、BANされたユーザーは送信も履歴閲覧もできなくなる
- [ ] `firebase.json` を書き換えた上で `firebase deploy --only hosting:client` が成功する
