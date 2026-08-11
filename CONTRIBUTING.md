# Contributing

## Branch Strategy

> **現状の実態**: このリポジトリは`main`ブランチのみで運用されており
> （`git branch -a`で確認可能）、`develop`・`feature/*`ブランチは実際には
> 使われていません。全てのCI（`token-server.yml`・`web-deploy.yml`・
> `admin-deploy.yml`等）も`branches: [main]`へのpushとPull Requestのみを
> トリガーとしています。以下は将来ブランチを分ける場合の推奨方針です
> （テンプレート作成時からの記述を踏襲しつつ、実態と乖離しないよう明記）。

- `main`: 常にデプロイ可能な状態を保つ。push時にCIが走り、成功すれば
  各サービス（`ptt-client`→Firebase Hosting `client`ターゲット、
  `admin-dashboard`→`admin`ターゲット、`token-server`→Cloud Run）へ
  自動デプロイされる
- `develop` / `feature/*`: 現状未使用。将来複数人での並行開発が必要に
  なった場合の候補パターンとして残しておくが、導入するかどうか自体
  未決定

## Pull Request

- モノレポ構成のため、CIは変更されたディレクトリ（`paths`フィルタ）に
  応じて該当するワークフローのみが走る（例: `ptt-client/**`の変更なら
  `web-deploy.yml`のみ、`token-server/**`の変更なら`token-server.yml`のみ）
- Pull Request向けには、Web版・admin-dashboardはFirebase Hosting Preview
  Channel（`pr-<PR番号>`）へのプレビューデプロイが自動実行される
  （`deploy-preview`ジョブ、`if: github.event_name == 'pull_request'`）
- `main`への実際のデプロイ（`deploy-production`）はPRマージ後、
  `main`へのpushをトリガーに実行される
- role・権限モデル（`lib/permissions.js`）に関わる変更を含むPRは、
  `role-sync-check.yml`が対象パスの変更を検知して自動的に走る

## Commit Message

> **現状の実態**: 実際のコミットメッセージは`update`・`fix`・`add`が
> ほとんどで、Conventional Commits（`feat:`/`fix:`等のプレフィックス）は
> 徹底されていません。以下は将来的に採用する場合の推奨規約です。

- `feat:` 新機能の追加
- `fix:` バグ修正
- `docs:` ドキュメントのみの変更（`brushup-plan.md`・`API.md`等）
- `refactor:` 挙動を変えないコードの整理（例: Phase12の
  `lib/permissions.js`への一元化）
- `test:` テストの追加・修正

Conventional Commitsを厳密に採用する場合、コミット履歴からの自動
CHANGELOG生成（`conventional-changelog`等）も選択肢になるが、現状の
`CHANGELOG.md`はコミット履歴からの自動生成ではなく、`brushup-plan.md`の
Phase単位の記録を手動で転記する運用としている（詳細は`CHANGELOG.md`
冒頭の注記を参照）。

## Code Review

- 単独開発者によるリポジトリのため、現状は形式的なレビュープロセス
  （必須承認者数の設定等）は導入していない
- 権限・セキュリティに関わる変更（`lib/permissions.js`・
  `firestore.rules`・`middleware/requireAuth.js`・`requireAdmin.js`等）
  は、変更後に`dev-tools/check.sh`または`dev-tools/test-roster.sh`での
  手動のHTTPレベル動作確認を行うことを推奨する（`TESTING.md`参照）
- ドキュメント（`brushup-plan.md`等）とコードの実装状況が乖離しないよう、
  実装を伴う変更を行った際は関連ドキュメントの該当箇所（機能差表・
  ロードマップ・API一覧等）も同一のまとまりで更新することを推奨する
  （過去に複数回、ドキュメントの記述だけが古いまま残る事例が発生している。
  事例は`brushup-plan-history.md`「第2部」item 2〜4等を参照）

## Coding Style

- Web（`ptt-client`）・`admin-dashboard`: ESLint + Prettierで統一。
  `npm run lint`（`eslint .`）・`npm run format`
  （`prettier --write "src/**/*.{ts,vue,css}"`）
- 共通デザイントークン: `shared/design-tokens.css`（Web系）・
  `Color+Tokens.swift`（iOS）・`PTTColors.kt`（Android）の3ファイルで
  色・スペーシング等を一元管理し、OS間の見た目の一貫性を保つ
  （`design-system-refactor-patch.md`参照）
- token-server: 現状Lint設定は未導入。CIでは構文チェック
  （`node --check`）のみ実施
- 権限判定ロジックは`token-server/lib/permissions.js`をSSOT（Single
  Source of Truth）とし、クライアント側はこれを手動で複製する運用
  （`roomPermissions.ts` / `PTTRoomPermissions.swift` /
  `PTTRoomPermissions.kt`）。API経由での動的取得は採用していない
  （`scripts/check-role-sync.js`による同期確認が前提の設計）
