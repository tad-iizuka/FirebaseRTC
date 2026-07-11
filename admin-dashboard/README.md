# PTT 管理者ダッシュボード — Vue 3 + TypeScript + Pinia + Tailwind + shadcn-vue

`admin-dashboard/public/index.html`(vanilla JS実装)を置き換える、`ptt-client`と同じ技術スタックの
リニューアル版です。

## `ptt-client`との関係(重要)

`独立プロジェクトとして複製する`方針で作っているため、`ptt-client`とは**コード上の依存関係が
一切ありません**。以下のファイルは`ptt-client`から内容をそのままコピーしたものです。将来
pnpm workspacesへ統合する際は、この一覧がそのまま「共通パッケージへ切り出す候補」になります。

| ファイル | 内容 |
|---|---|
| `src/lib/firebase.ts` | Firebase初期化(同一プロジェクト `fir-rtc-de1f4` を指す) |
| `src/lib/api.ts` | 認証付きfetchラッパー(`authedFetch` / `ApiError`) |
| `src/lib/utils.ts` | `cn()` |
| `src/components/ui/*.vue` | shadcn-vue風UIプリミティブ(Button/Input/Card/Badge) |
| `src/stores/auth.ts` | Google/Appleサインイン |
| `src/style.css` / `tailwind.config.ts` | ダーク+monospaceのデザイントークン |
| `eslint.config.js` / `tsconfig.*` / `vite.config.ts` / `vitest.config.ts` | ツールチェイン設定一式 |

`src/types/api.ts`は`ptt-client`版から`ServerErrorResponse`だけを抜き出した最小構成です
(PTT本体のルーム/チャット等の型はこのアプリでは不要なため)。

admin固有で新規に書いたのは以下です。

- `src/types/admin.ts` — `GET /admin/rooms` / `GET /admin/rooms/:roomId` のレスポンス型
- `src/stores/adminRooms.ts` — 一覧取得・ページング・詳細取得・403判定
- `src/stores/settings.ts` — トークンサーバーURLの永続化(LiveKit URLは不要なので`ptt-client`版から削減)
- `src/lib/format.ts` — 日時フォーマットの小ユーティリティ
- `src/views/RoomsListView.vue` / `RoomDetailView.vue` / `AuthView.vue`
- `src/components/AppHeader.vue`(channelLabelが無い、admin専用の簡略版)

## セットアップ

```bash
cd admin-dashboard
npm install
npm run dev
```

```bash
npm run build     # 型チェック + 本番ビルド → dist/
npm run test
npm run lint
npm run format
```

`npm install` → `lint` → `test` → `build` まで通ることをこの環境で確認済みです。

## 権限の付与

閲覧には Firestore の `adminUsers/{uid}.permissions` に `rooms:monitor` が必要です。

```bash
node dev-tools/grant-admin-permission.js grant <uid> rooms:monitor "運用チームリーダー"
```

権限が無いアカウントでサインインすると、一覧/詳細どちらも「管理者権限がありません」という
専用メッセージが表示されます(`adminRooms.isForbidden`で汎用エラーと区別しています)。

## `firebase.json` / CI に必要な変更

`ptt-client`と同様、ビルドレスの静的配信からVite成果物の配信に変わります。

```diff
  {
    "target": "admin",
-   "public": "admin-dashboard/public",
+   "public": "admin-dashboard/dist",
    "ignore": [...],
    "headers": [...]
  }
```

`.github/workflows/admin-deploy.yml` に、`web-deploy.yml`(更新版)と同じ形で
Node.jsセットアップ + `npm ci` + `npm run lint` + `npm run test` + `npm run build` を追加し、
`ptt-client-dist` と同様に `admin-dashboard-dist` をartifactとして
`deploy-preview` / `deploy-production` の両ジョブへ渡すよう変更してください
(現行の `html-validate` チェックは廃止します)。

## 意図的に省略した箇所

- `dev-tools/admin-dashboard.html` は開発専用ツールとして今回は手を付けていません(元々
  ローカル専用の位置づけのため)。
- ページング操作は「次のページ」のみです(旧実装の`cursorStack`による「前のページ」機能は
  移植していません)。必要であれば`stores/adminRooms.ts`に`goToPreviousPage()`を追加してください。
