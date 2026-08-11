# Testing

> 現状の実際のテスト体制をありのまま記録したものです。「何が整備されて
> いて、何がまだ整備されていないか」を明確にすることを優先しています。

## Unit Test

| 対象 | ツール | 実行コマンド | 状況 |
|---|---|---|---|
| `ptt-client`（Web） | Vitest | `npm run test`（`vitest run`） | 3ファイルのみ（`onboarding.spec.ts`・`savedRooms.spec.ts`・`linkify.spec.ts`）。カバレッジは限定的 |
| `admin-dashboard` | Vitest | `npm run test`（`vitest run`） | 1ファイルのみ（`api.spec.ts`） |
| `ptt-ios` | XCTest | `xcodebuild test -only-testing:ptt-iosTests` | Xcode生成のボイラープレート（`ptt_iosTests.swift`）のみ、実質的なカバレッジなし |
| `ptt-android` | JUnit | `./gradlew testDebugUnitTest` | テストファイル自体が存在しない（CIでは空実行される） |
| `token-server` | なし | — | `npm test`で動くテストスイートが無い。CIでは全JSファイルの`node --check`による構文チェックのみ実施（`.github/workflows/token-server.yml`） |

**優先度の高いギャップ**: `token-server`はアプリの権限判定ロジック
（`lib/permissions.js`）を含む最重要モジュールでありながら、単体テストが
一切無い。Phase14の「自動テスト・E2Eテストの拡充」で最初に着手すべき対象。

## Integration Test

自動化されたインテグレーションテストは無い。代わりに以下のシェル
スクリプトによる手動のHTTPレベル統合確認を行っている。

- `dev-tools/check.sh`：ルーム作成→トークン取得→（2人目のトークンがあれば）
  参加→BAN→BAN後のアクセス拒否確認、という一連の流れをcurlで通しで確認する。
  **注意**: 実行にはFirebase ID Tokenをスクリプト内にハードコードする運用に
  なっており、リポジトリにコミットされたトークンが残存する形になっている
  （Firebase ID Tokenは通常発行から1時間で失効するため実害は限定的だが、
  今後は環境変数経由に切り替えることを推奨する）
- `dev-tools/test-roster.sh`：組織ロースター層（admin/staff、scopeNodeIds、
  override規約）の動作確認。全14ステップをPASSすることを確認済み
  （2026-07-25時点）。事前に`ROOT_TOKEN`/`TOKEN_A`〜`C`等の環境変数設定が
  必要

いずれもローカルまたはデプロイ済み環境に対して手動実行する運用であり、
CIには組み込まれていない。

## UI Test

- `ptt-iosUITests`：Xcode生成のボイラープレート（`testExample`/
  `testLaunchPerformance`）のみで実質的なカバレッジはゼロ。CIでは
  Accessibilityサブシステムの初期化待ちでハングしやすいため意図的に除外
  （`-only-testing:ptt-iosTests`でスコープを絞っている）。実際のPTT機能を
  検証するUIテストを書き始める際の手順は`ios-ci.yml`内のコメント
  「UI Tests (SKIPPED)」を参照
- Android版のUIテスト（Compose Test）は未整備
- Web版のE2Eテスト（Playwright等）は未整備

## Load Test

未整備。同時接続数・Room数に対する負荷試験は実施していない。LiveKit側の
スケーラビリティはLiveKit Cloud側の責務として委譲しているが、token-server
（Cloud Run）側の負荷試験・オートスケール設定の検証も行っていない。

## Security Test

自動化されたセキュリティテスト（SAST/DAST等）は未導入。現状の担保は以下:

- `npm audit --audit-level=high`をCI（`token-server.yml`・`web-deploy.yml`・
  `admin-deploy.yml`）で実行するが、`continue-on-error: true`のためデプロイ
  はブロックしない（可視化のみ）
- `role-sync-check.yml`：role×操作の対応表（`lib/permissions.js`）とクライアント
  側の複製定義の整合性を機械的に検証（権限モデルの意図しない乖離を防ぐ
  という意味での準security test）
- Firestoreのアクセス制御は`firestore.rules`によるルールベースの防御が
  中心（クライアント直接書き込みを原則禁止）。ルール自体の自動テスト
  （`@firebase/rules-unit-testing`等）は未導入

詳細な設計上の考え方は`SECURITY.md`を参照。

## Manual Checklist

新機能をリリースする際の最低限の手動確認項目（現状の慣行を明文化）:

- [ ] Web版: `npm run lint`（ESLint）・`npm run test`（Vitest）・
      `npm run build`（`vue-tsc -b && vite build`）がいずれもエラー0件で
      完走すること
- [ ] admin-dashboard: 同上（Web版と同じコマンド体系）
- [ ] token-server: 変更したJSファイルが`node --check`で構文エラーにならない
      こと。権限判定に関わる変更の場合は`dev-tools/check.sh`または
      `dev-tools/test-roster.sh`で手動のHTTPレベル確認を行うこと
- [ ] iOS/Android: この開発環境にはXcode/Android Studioが無いため、実機/
      シミュレータでのビルド確認はユーザー側で行う（`brushup-plan.md`の
      「次アクション」に実機確認待ちの項目として記録される運用）
- [ ] role・権限に関わる変更を行った場合は`scripts/check-role-sync.js`
      （CI: `role-sync-check.yml`）が通ることを確認する
- [ ] ドキュメントを更新した場合、`brushup-plan.md`側の該当箇所（機能差表・
      ロードマップ・次アクション）が古い記述のまま残っていないか確認する
      （過去に複数回、ドキュメントの陳腐化が発見されている）
