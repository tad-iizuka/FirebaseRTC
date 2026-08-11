# Deployment

## Environment

現状、Firebaseプロジェクトは`dev`（`fir-rtc-de1f4`）の1環境のみが
`.firebaserc`に登録されている。Staging/Productionという名前での環境分離は
行っていない（`.firebaserc`の`projects.dev`という命名だが、実質的に本番
相当のトラフィックもこのプロジェクトで受けている）。

| 環境 | Firebaseプロジェクト | 用途 |
|---|---|---|
| Development | `fir-rtc-de1f4` | ローカル開発（`npm run dev`等）。`token-server`はローカル起動 |
| （PRプレビュー） | `fir-rtc-de1f4`（Hosting Preview Channel） | PR単位の一時プレビュー（`pr-<PR番号>`、7日程度で自動失効） |
| Production | `fir-rtc-de1f4` | `main`ブランチへのマージで自動デプロイ（live channel） |

Staging環境を独立させる場合、`.firebaserc`に新規プロジェクトエイリアスを
追加し、GitHub Actions側の`vars.FIREBASE_PROJECT_ID`等の変数を環境ごとに
分岐させる必要がある（現状は単一の値をハードコード的に参照）。

## Firebase

### Hosting

`firebase.json`で2つのHostingターゲットを定義している。

| target | 配信元 | 用途 |
|---|---|---|
| `client` | `ptt-client/dist` | Webクライアント本体。`appAssociation: NONE`（Universal Link用の`.well-known`を独自配信するため）、SPAとして全パスを`index.html`にrewrite |
| `admin` | `admin-dashboard/dist` | 運用者向け管理画面。`X-Robots-Tag: noindex, nofollow`を全パスに付与し検索エンジンからの露出を防ぐ |

`.firebaserc`の`targets`でプロジェクト`fir-rtc-de1f4`に対し、`client`→
`fir-rtc-de1f4`（メインドメイン）、`admin`→`fir-rtc-de1f4-admin`
（別サブドメイン相当）をひも付けている。

Universal Link / App Link用に、`ptt-client/public/.well-known/`配下へ
`apple-app-site-association`（iOS Team ID・Bundle ID指定）・
`assetlinks.json`を配置し、`firebase.json`の`headers`で
`Content-Type: application/json`を明示している。

### Functions

未使用。バックエンドロジックは全てCloud Run上の`token-server`（Express）
に集約しており、Cloud Functionsは採用していない。

### Firestore

`firebase.json`で`firestore.rules`・`firestore.indexes.json`を指定。
デプロイは`firebase deploy --only firestore`（GitHub Actionsのワークフロー
には現状組み込まれておらず、ルール変更時は手動デプロイが必要と見られる。
要確認）。

### Storage

Firestoreとは別に、録音ファイル・チャット添付ファイルは Firebase Storage
ではなく**Google Cloud Storage（GCS）**に直接保存する設計（後述）。

### Authentication

Firebase Authenticationを認証基盤として使用。有効化しているプロバイダは
Google等の通常サインインに加え、Guestロール用の匿名認証。

## LiveKit

- LiveKit Cloud（`https://ubunifu-talk-wy19xst3.livekit.cloud`）を使用。
  自前ホストのLiveKitサーバーへの切り替えも`LIVEKIT_HOST`の変更のみで
  理論上は可能な設計
- クライアント接続用の`wss://`エンドポイントと、サーバーの管理API
  （`RoomServiceClient`/`EgressClient`）用の`https://`エンドポイントは
  別物であることに注意（`.env.example`に明記）
- Webhook（`room_started`/`room_finished`/`participant_joined`等）は
  `POST /webhooks/livekit`で受信し、LiveKit Cloud側のSettings > Webhooksで
  このURLを事前登録しておく必要がある。署名検証は`LIVEKIT_API_KEY`/
  `LIVEKIT_API_SECRET`を流用するため専用シークレットは不要
- 録音（Room Composite Egress）の出力先はGCS。`RECORDING_GCS_BUCKET`で
  バケットを指定し、書き込み権限を持つサービスアカウントの認証情報を
  `RECORDING_GCS_KEY_FILE`（ローカル）または`RECORDING_GCS_CREDENTIALS_JSON`
  （本番、Secret Manager経由）で渡す

## Cloud Run

`token-server`はCloud Run（`asia-northeast1`）にコンテナとしてデプロイ
される（`--source token-server`によるビルドパックデプロイ、Dockerfile
使用）。

```bash
gcloud run deploy ptt-token-server \
  --source token-server \
  --region asia-northeast1 \
  --project <GCP_PROJECT_ID> \
  --allow-unauthenticated \
  --set-secrets LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest,RECORDING_GCS_CREDENTIALS_JSON=recording-gcs-credentials:latest,ATTACHMENTS_GCS_CREDENTIALS_JSON=attachments-gcs-credentials:latest,INTERNAL_SWEEP_SECRET=internal-sweep-secret:latest \
  --set-env-vars "LIVEKIT_HOST=...,FIREBASE_PROJECT_ID=...,ALLOWED_ORIGINS=...,RECORDING_GCS_BUCKET=...,ATTACHMENTS_GCS_BUCKET=..."
```

`--allow-unauthenticated`としているのは、認証をCloud Run自体のIAMではなく
アプリケーション層（Firebase ID Token検証、`middleware/requireAuth.js`）
で行う設計のため。

デプロイ後、`curl`によるヘルスチェック（`GET /`が`"OK"`を含むことを確認）
をCIの最終ステップとして実行している。

### Cloud Scheduler（要確認）

Room終了時刻経過による強制退出（`POST /internal/rooms/sweep-expired`）を
定期実行するCloud Schedulerジョブについて、Secret Manager登録・Cloud Run
への`INTERNAL_SWEEP_SECRET`受け渡しの準備はコード上確認できるが、
**Cloud Scheduler側のジョブ自体が実際に作成されているかはリポジトリの
コードからは確認できない**（`brushup-plan.md`「6. 次アクションの提案」
item 7）。未作成の場合、終了時刻を過ぎたRoomがsweepされず残り続ける。

## GitHub Actions

モノレポ構成のため、各ワークフローは対象ディレクトリの変更のみで
トリガーされる（`paths`フィルタ）。

| ワークフロー | トリガー対象 | 内容 |
|---|---|---|
| `token-server.yml` | `token-server/**` | 構文チェック→`npm audit`（可視化のみ）→Cloud Runへデプロイ（`main`のみ） |
| `web-deploy.yml` | `ptt-client/**`, `firebase.json`, `.firebaserc` | lint/test/build→Hosting（`client`）へデプロイ、PRはPreview Channel |
| `admin-deploy.yml` | `admin-dashboard/**`, `firebase.json`, `.firebaserc` | 同上（`admin`ターゲット） |
| `android-ci.yml` | `ptt-android/**` | lint/unit test/`assembleDebug`。デプロイは無し（ビルド確認のみ） |
| `ios-ci.yml` | `ptt-ios/**` | build/unit test（`ptt-iosTests`のみ）。デプロイは無し |
| `role-sync-check.yml` | 権限関連ファイル | `lib/permissions.js`とクライアント側複製定義の同期チェック |

Cloud Runへのデプロイ認証はWorkload Identity Federation
（`google-github-actions/auth@v2`）を使用し、サービスアカウントキーの
JSONをGitHub Secretsへ直接保存する方式は採用していない。

## Secrets

| Secret名 | 保存先 | 用途 |
|---|---|---|
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | GCP Secret Manager | LiveKit認証・Webhook署名検証 |
| `RECORDING_GCS_CREDENTIALS_JSON` | GCP Secret Manager | 録音ファイルのGCS書き込み |
| `ATTACHMENTS_GCS_CREDENTIALS_JSON` | GCP Secret Manager | チャット添付ファイルのGCS書き込み |
| `INTERNAL_SWEEP_SECRET` | GCP Secret Manager | Room終了時刻のsweep処理エンドポイント保護 |
| `GCP_WIF_PROVIDER` / `GCP_DEPLOY_SA` | GitHub Secrets | Cloud Runデプロイ用のWorkload Identity Federation |
| `FIREBASE_SERVICE_ACCOUNT` | GitHub Secrets | Firebase Hostingデプロイ |
| `ANDROID_GOOGLE_SERVICES_JSON` | GitHub Secrets（base64） | Android版ビルド時の`google-services.json`復元 |
| `IOS_GOOGLE_SERVICE_INFO_PLIST` | GitHub Secrets（base64） | iOS版ビルド時の`GoogleService-Info.plist`復元 |

**注意**: `dev-tools/check.sh`には手動確認用に取得したFirebase ID Token
の実値がハードコードされた状態でリポジトリにコミットされている。ID Token
は発行から1時間で失効するため実害は限定的だが、今後は環境変数経由
（例: `TOKEN=$FIREBASE_ID_TOKEN ./check.sh`）に切り替え、実値をコミット
しない運用への変更を推奨する。

## Monitoring

- **Cloud Logging**: Cloud Run（token-server）の標準出力ログが自動収集
  される。LiveKit Webhookイベントも1行JSONとして`console.log`しており
  Cloud Logging側で検索・集計できる
- **Firestore `events`コレクション**: LiveKit Webhookイベントの生データを
  ベストエフォートで保存（Cloud Loggingへの記録が主、Firestore書き込み
  失敗時もWebhook自体は200を返す設計）
- **監査ログ（`auditLogs`コレクション）**: 管理者操作（BAN・role変更・
  バッジ付与剥奪等）を記録。`GET /admin/audit-logs`（`audit:read`権限）
  で閲覧可能
- **Crashlytics**: iOS/Android版への導入状況はこのドキュメント作成時点で
  未確認（要調査）
- アラート・SLO監視（Cloud Monitoringのアラートポリシー等）は未整備
