# ptt-token-server

`ptt-server/server.js`（WS制御 + Opusミキシング）の後継。
当初は「Firebase AuthのID Tokenを検証してLiveKitのJWTを発行するだけ」の
軽量サーバーだったが、招待制ルーム管理・BAN・通報機能・送話ロック・
録音(Egress)機能の追加により、実質的に「ルーム管理を持つ小さなバックエンド」に
拡張されている。

- フェーズ1: Firebase Authによるなりすまし防止
- フェーズ2: 招待制ルーム管理・BAN・通報機能・送話ロック
- フェーズ4: LiveKit Webhook受信による可観測性・運用
- フェーズ5: テキストチャット・複数ルーム横断監視ダッシュボード等の付加機能
- **フェーズ8: 運用機能の拡充(監査ログ・moderator任命API・録音履歴一覧/ダウンロードAPI・
  Firestore/GCSのデータライフサイクル管理・管理者ダッシュボードへの権限管理UI)**

## アーキテクチャ

```
lib/firebaseAdmin.js   … Firebase Admin SDK初期化 (db, auth を export)
lib/roomMetadata.js     … LiveKit Room Metadataへの書き込みを一箇所に集約
(talkLock/recordingの状態を合成して同期する) [Phase5で追加]
lib/auditLog.js         … 管理系操作(BAN/role変更/録音操作/権限変更等)の
監査ログ記録を一箇所に集約 [Phase8で追加]
middleware/requireAuth.js … ID Token検証ミドルウェア、roomIdバリデーション
middleware/requireAdmin.js … adminUsers/{uid}.permissions を見る汎用権限チェック [Phase5で追加]
routes/rooms.js         … ルーム作成 / 招待コードでの参加 / BAN / role変更(moderator任命) [Phase8でrole変更を追加]
routes/token.js         … メンバーシップ確認付きLiveKitトークン発行
routes/reports.js       … 通報受付 [Phase8でexpireAt(TTL)を追加]
routes/talk.js          … 送話ロック(排他制御) [Phase 2で追加]
routes/recording.js     … 録音(Egress)の開始/停止/状態取得/一覧/ダウンロードURL発行。
保存先はGCS [Phase5で追加、Phase8で一覧・ダウンロードURLを追加]
routes/webhooks.js      … LiveKit Webhook受信(Egress終了イベントの確定処理、
録音履歴のサブコレクション保存) [Phase4で追加、Phase8で履歴保存を追加]
routes/messages.js      … テキストチャット [Phase5で追加]
routes/admin.js         … 複数ルーム横断監視API、監査ログ閲覧API、管理者権限管理API
[Phase5で追加、Phase8で監査ログ・権限管理APIを追加]
server.js               … 上記をマウントするエントリーポイント
firestore.rules         … クライアントからの直接書き込み禁止ルール
firestore.indexes.json  … 監査ログ検索用の複合インデックス [Phase8で追加]
phase8-operations.md    … TTL/GCSライフサイクル設定手順・Phase8チェックリスト [Phase8で追加]
```

## 認証・認可の設計

### 認証: Firebase Auth
`Authorization: Bearer <Firebase ID Token>` を全エンドポイント共通で必須とする。
Firebase Admin SDK (`admin.auth().verifyIdToken()`) で検証し、得られる `uid` を
以後の全ての処理で「そのユーザー本人」として扱う。クライアントが自己申告する
identity・uid相当の値は一切信用しない。

例外: `/webhooks/livekit` はLiveKitサーバーからのサーバー間通信であり
Firebase ID Tokenを持たないため、代わりに `WebhookReceiver` によるLiveKit独自の
署名検証を行う(下記「録音機能(Egress)」の節を参照)。

### 認可: 招待制ルーム
「ルームIDを知っていれば誰でも入れる」状態を避けるため、ルームは
`invite_only` とし、参加には招待コードの検証を必須にした。

**データモデル (Firestore)**

```
rooms/{roomId}
  - ownerUid: string
  - createdAt: timestamp
  - visibility: "invite_only"
  - inviteCode: string (8文字の英数字)
  - maxMembers: number
  - talkLock: { uid, acquiredAt, expiresAt } | null                  [Phase 2で追加]
  - recording: { active, egressId, startedAt, startedByUid } | null  [Phase5で追加]

rooms/{roomId}/members/{uid}
  - role: "owner" | "moderator" | "member"
  - displayName: string
  - status: "active" | "banned"
  - joinedAt: timestamp

rooms/{roomId}/messages/{messageId}                                  [Phase5で追加]
  - uid, displayName, text, createdAt

rooms/{roomId}/recordings/{egressId}                                 [Phase8で追加]

  - egressId, filepath, startedAt, endedAt, status, startedByUid
  - routes/webhooks.js の handleEgressEnded() が egress_ended 受信時に書き込む、録音の「確定した履歴」。rooms/{roomId}.recording が「現在進行中の録音1件」しか保持しないのに対し、こちらは過去分を含めて蓄積される。

reports/{reportId}
  - reporterUid, reportedUid, roomId, reason, status, createdAt
  - expireAt: timestamp                                              [Phase8で追加、TTL用]

adminUsers/{uid}                                                     [Phase5で追加]

  - permissions: string[]  (例: ["rooms:monitor", "audit:read", "admins:manage"])
  - grantedAt, note

auditLogs/{logId}                                                    [Phase8で追加]

  - actorUid, action, targetRoomId, targetUid, detail, createdAt
  - expireAt: timestamp (TTL用)
  - lib/auditLog.js の logAdminAction() が管理系操作のたびに書き込む
```

**クライアントからFirestoreへの直接書き込みは一切許可しない**（`firestore.rules`参照）。
ルーム作成・参加・BAN・送話ロック・録音の開始/停止は全てこのサーバーのAPI
（Admin SDK経由）でのみ行われる。例外として、自分自身の `members/{uid}` ドキュメントの
読み取りだけはクライアントに許可している。これはリアルタイムリスナーで
「自分がBANされたこと」を即座にUIへ反映するための補助であり、BAN自体の
強制力はLiveKit側の即時キックが担う。

## API一覧

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| GET | `/` | 不要 | ヘルスチェック |
| POST | `/rooms` | 必須 | ルーム作成。呼び出しユーザーがownerになる。招待コードを返す |
| POST | `/rooms/:roomId/join` | 必須 | 招待コードを検証しmembersに追加 |
| GET | `/token?room=roomId` | 必須 | メンバーシップ確認後、LiveKit接続用JWTを発行 |
| POST | `/rooms/:roomId/members/:targetUid/ban` | 必須(owner/moderatorのみ) | BAN化 + LiveKitから即時キック |
| POST | `/rooms/:roomId/members/:targetUid/role` | 必須(ownerのみ) | moderator/memberへのrole変更 **[Phase8]** |
| POST | `/rooms/:roomId/talk/start` | 必須(メンバーのみ) | 発話ロックの取得 |
| POST | `/rooms/:roomId/talk/heartbeat` | 必須(メンバーのみ) | 発話ロックの延長 |
| POST | `/rooms/:roomId/talk/stop` | 必須(メンバーのみ) | 発話ロックの解放 |
| POST | `/rooms/:roomId/recording/start` | 必須(owner/moderatorのみ) | 録音(Egress)を開始。保存先はGCS |
| POST | `/rooms/:roomId/recording/stop` | 必須(owner/moderatorのみ) | 録音の停止を依頼(確定はWebhook側) |
| GET | `/rooms/:roomId/recording/status` | 必須(メンバーのみ) | 現在の録音状態を取得 |
| GET | `/rooms/:roomId/recordings` | 必須(メンバーのみ) | 録音履歴の一覧 **[Phase8]** |
| GET | `/rooms/:roomId/recordings/:recordingId/download-url` | 必須(owner/moderatorのみ) | GCS署名付きダウンロードURL発行(5分間有効) **[Phase8]** |
| POST | `/webhooks/livekit` | LiveKit署名検証 | LiveKitからのWebhook受信(Egress終了等) |
| POST | `/reports` | 必須 | 通報の受付(対応は人力運用) |
| POST | `/rooms/:roomId/messages` | 必須(メンバーのみ) | テキストチャット送信 |
| GET | `/admin/rooms` | 必須(`rooms:monitor`) | 複数ルーム横断の一覧監視 |
| GET | `/admin/rooms/:roomId` | 必須(`rooms:monitor`) | ルーム詳細監視 |
| GET | `/admin/audit-logs` | 必須(`audit:read`) | 監査ログ一覧(roomId/actorUidで絞込可) **[Phase8]** |
| GET | `/admin/admins` | 必須(`admins:manage`) | 管理者権限台帳の一覧 **[Phase8]** |
| POST | `/admin/admins/:uid/permissions` | 必須(`admins:manage`) | 他ユーザーへの権限付与/剥奪(`admins:manage`自体は対象外) **[Phase8]** |

### なぜBANはFirestore書き換えだけで済まないのか

`AccessToken` のTTLは10分に設定している。Firestoreの `status` を `banned` に
書き換えただけでは、対象ユーザーが既に持っているLiveKitトークン・接続そのものは
有効なままのため、最大10分間は接続し続けられてしまう。これを避けるため、
BAN処理では `RoomServiceClient.removeParticipant()` を同時に呼び、
その場でLiveKitの接続を物理的に切断する。

### moderator任命について【Phase8】

「誰が新しいmoderatorを任命できるか」を単純に保つため、`POST
/rooms/:roomId/members/:targetUid/role` の実行権限はowner本人のみに固定した
(moderatorが別のmoderatorを任命・降格することはできない)。ownerロール自体は
このAPIでは変更できない(ownerが誤って自分をmemberに降格し、以後誰も管理操作
できなくなる事故を防ぐため)。adminUsersの`admins:manage`をAPI化せず
dev-tools経由の手動運用に固定しているのと同じ、「権限を持つ人を増やせる人」を
単純化する考え方に沿っている。

### 送話ロック(排他制御)について

「誰か1人が話している間は他の人が発話できない」を、クライアント側のUI抑制だけに
頼らず、Firestoreトランザクションでサーバー側から実効的に強制している。
取得・延長・解放のたびに、現在の話者情報をLiveKitのRoom Metadataへ書き込み、
接続中の全クライアントへ `RoomMetadataChanged` イベントとしてリアルタイムに
伝播させる。

### 録音機能(Egress)について

LiveKitの Room Composite Egress を使い、ルーム全体の音声を1本のファイルに
ミックスして **GCS(Google Cloud Storage)** へ保存する。開始/停止は
owner/moderatorのみに限定している。

**録音中であることは全参加者に開示する**設計にしている。これは同意の観点で
重要なため、送話ロックと同じRoom Metadataの仕組みに相乗りし、録音開始と同時に
`recording: { active: true, startedAt }` を全クライアントへブロードキャストする。

送話ロックと録音の両方が同じRoom Metadata(単一のJSON文字列)を更新したいため、
個別に書き込むと片方がもう片方のフィールドを消してしまうレースが起きる。
これを避けるため、Metadataへの書き込みは必ず `lib/roomMetadata.js` の
`syncRoomMetadata(roomId)` を経由させ、Firestoreの `talkLock` / `recording` の
両方を読み出してから1回のJSONとして合成・書き込みする設計にしている。

**GCSアップロード用の認証情報について。** `GCPUpload` の `credentials` は
サービスアカウントJSONの中身を文字列として直接要求するAPIであり、Firebase
Admin SDKが使う `GOOGLE_APPLICATION_CREDENTIALS`(ADC経由)とは別の仕組みである
点に注意。ローカル開発では `RECORDING_GCS_KEY_FILE`(JSONファイルのパス)、
Cloud Run本番環境ではSecret Manager経由の `RECORDING_GCS_CREDENTIALS_JSON`
(JSON文字列そのもの)のいずれかを使う。サービスアカウントには対象バケットへの
`Storage Object Admin`(またはそれに準ずる書き込み権限)ロールが必要。

**`/recording/stop` は「停止の依頼」に過ぎない点に注意。** Egressの実際の終了
(成功/失敗いずれも)は非同期にLiveKitから通知されるため、Firestore上の
`recording.active` を確定的に `false` にする処理は `/recording/stop` の
レスポンス内では行わず、`routes/webhooks.js` が受け取る `egress_ended`
イベントに一本化している。これにより、Egress停止に時間がかかった場合や
何らかの理由でEgressが自然終了した場合でも、Firestore側の状態を正しく
確定させられる。

Webhookは `WebhookReceiver` によるLiveKit独自の署名検証を行うため、
Firebase Authの認証は使わない。この検証には生のリクエストボディ文字列が
必要なため、`server.js` では `/webhooks` パスにのみ `express.json()` より前に
`express.raw({ type: 'application/webhook+json' })` を適用している。

古いEgressの遅延イベントによって、既に開始されている新しい録音の状態を
誤って消してしまわないよう、`egress_ended` の処理では
`Firestoreに保存されたegressId` と `イベントのegressId` が一致する場合のみ
状態を更新する(一致しなければ無視する)。

### 監査ログについて【Phase8】

BAN・role変更・録音の開始/停止依頼・ダウンロードURL発行・管理者権限の付与/剥奪
といった管理系操作は、すべて `lib/auditLog.js` の `logAdminAction()` を経由して
`auditLogs` コレクションへ記録される。`lib/roomMetadata.js` が「Room Metadataへの
書き込みを一箇所に集約する」のと同じ考え方で、監査ログの書き込み経路を分散させない
ようにしている。監査ログの書き込みが失敗しても本来の操作(BAN等)自体は失敗させない
(ベストエフォート)。

`GET /admin/audit-logs` は `roomId` / `actorUid` で絞り込めるが、これは
`where + orderBy(createdAt)` の複合クエリになるため、事前に
`firestore.indexes.json` のインデックスをデプロイしておく必要がある
(`phase8-operations.md` 参照)。

### 管理者権限の管理について【Phase8】

`adminUsers/{uid}.permissions` の付与/剥奪を `POST
/admin/admins/:uid/permissions` でAPI化したが、**`admins:manage` 自体はこの
APIでは付与/剥奪できない**よう明示的にガードしている。自己昇格・権限
エスカレーションのリスクを避けるため、`admins:manage` の付与は
`dev-tools/grant-admin-permission.js` でのFirestoreへの直接書き込み権限を持つ
運用者による手動運用に固定している(README「moderator権限の付与手段が無い」の
節で述べていた設計思想を、`admins:manage`自体には引き続き適用している)。

### Firestore/GCSのデータライフサイクル管理について【Phase8】

`reports` と `auditLogs` は書き込み時に `expireAt` フィールドをセットしており、
Firestore側のTTLポリシーを有効化することで一定期間後に自動削除される。
録音ファイル本体(GCS)にはバケットのライフサイクルルールで、一定期間後に
低頻度アクセスクラスへの移行・削除を設定する。具体的な `gcloud` コマンドは
`phase8-operations.md` にまとめている(このREADME内では重複させない)。

## ローカル動作確認

```bash
cd token-server
npm install
cp .env.example .env
```

`.env` に以下を設定する:

- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_HOST`
- `FIREBASE_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS`（Firebase Console > プロジェクトの設定 >
  サービスアカウント > 新しい秘密鍵の生成、で取得したJSONのパス）
- `ALLOWED_ORIGINS`（ローカルでWeb版を試す場合は `http://localhost:xxxx` など）
- `RECORDING_GCS_BUCKET` / `RECORDING_GCS_KEY_FILE`（録音機能を試す場合。
  GCSバケットへの書き込み権限を持つサービスアカウントのJSONキーを別途発行し、
  そのパスを指定する）

```bash
node -r dotenv/config server.js
```

別ターミナルで、実際にFirebaseにサインインして取得したID Tokenを使って確認:

```bash
TOKEN="<FirebaseのID Token>"

# ルーム作成
curl -X POST "http://localhost:8080/rooms" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"maxMembers": 10}'
# => {"roomId":"xxxx","inviteCode":"AB3D9F2K"}

# 別ユーザーが招待コードで参加
curl -X POST "http://localhost:8080/rooms/xxxx/join" \
  -H "Authorization: Bearer $OTHER_USER_TOKEN" -H "Content-Type: application/json" \
  -d '{"inviteCode": "AB3D9F2K"}'

# メンバーになったのでLiveKitトークンを取得できる
curl "http://localhost:8080/token?room=xxxx" -H "Authorization: Bearer $TOKEN"

# ownerが別ユーザーをBAN
curl -X POST "http://localhost:8080/rooms/xxxx/members/<OTHER_UID>/ban" \
  -H "Authorization: Bearer $TOKEN"

# [Phase8] ownerが別ユーザーをmoderatorに任命
curl -X POST "http://localhost:8080/rooms/xxxx/members/<OTHER_UID>/role" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"role": "moderator"}'

# ownerが録音を開始
curl -X POST "http://localhost:8080/rooms/xxxx/recording/start" \
  -H "Authorization: Bearer $TOKEN"

# ownerが録音の停止を依頼(この時点ではまだactiveのまま。egress_endedのWebhookで確定する)
curl -X POST "http://localhost:8080/rooms/xxxx/recording/stop" \
  -H "Authorization: Bearer $TOKEN"

# [Phase8] 録音履歴の一覧(メンバーなら誰でも可)
curl "http://localhost:8080/rooms/xxxx/recordings" -H "Authorization: Bearer $TOKEN"

# [Phase8] ダウンロードURLの発行(owner/moderatorのみ)
curl "http://localhost:8080/rooms/xxxx/recordings/<EGRESS_ID>/download-url" \
  -H "Authorization: Bearer $TOKEN"

# [Phase8] 監査ログの閲覧(audit:read権限が必要)
curl "http://localhost:8080/admin/audit-logs?roomId=xxxx" \
  -H "Authorization: Bearer $TOKEN"

# [Phase8] 他ユーザーへの権限付与(admins:manage権限が必要)
curl -X POST "http://localhost:8080/admin/admins/<TARGET_UID>/permissions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"permission": "audit:read", "action": "grant"}'
```

ローカル環境ではLiveKitからのWebhookを直接受け取れないため、`ngrok` 等で
一時的に公開URLを払い出し、LiveKit Cloud の Webhook設定に登録すると
`egress_ended` の受信まで含めて動作確認できる。

## Firestoreセキュリティルール・インデックスのデプロイ

リポジトリルートに `firebase.json` と `firestore.rules` を追加済み。
**[Phase8]** 監査ログ検索用の複合インデックス定義 `firestore.indexes.json` も
追加し、`firebase.json` の `firestore.indexes` から参照させている。
初回のみプロジェクトを紐付けてから、通常のデプロイコマンドでルール・
インデックスを反映する。

```bash
# リポジトリルートで実行
firebase use --add   # 対象のFirebaseプロジェクトを選択・.firebaserc生成(初回のみ)
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

デプロイ後、`rooms`・`rooms/{roomId}/members`・`reports` への直接書き込みが
クライアントSDKから一切できなくなっていることを確認する
(下の動作確認チェックリストの該当項目を参照)。

インデックス未デプロイの状態で `GET /admin/audit-logs?roomId=...` を叩くと
`FAILED_PRECONDITION` エラーが返るので、これを起点にデプロイ漏れに気づける。

## Cloud Runへのデプロイ

### 0. GCS側の準備(録音機能を使う場合、初回のみ)

```bash
# 録音保存用のバケットを作成
gcloud storage buckets create gs://your-recording-bucket --location=asia-northeast1

# アップロード専用のサービスアカウントを作成し、キーを発行
gcloud iam service-accounts create ptt-recording-uploader \
  --display-name="PTT録音アップロード用"

gcloud storage buckets add-iam-policy-binding gs://your-recording-bucket \
  --member="serviceAccount:ptt-recording-uploader@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud iam service-accounts keys create recording-service-account.json \
  --iam-account="ptt-recording-uploader@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

発行した `recording-service-account.json` の中身(JSON全体)をSecret Managerに
登録する(下記手順1)。**[Phase8]** このサービスアカウントの認証情報は録音の
アップロードだけでなく、ダウンロードURLの署名にも使われる(別途の追加権限は
不要)。

**[Phase8]** GCSバケットのライフサイクルルール(一定期間後にColdlineへ移行・削除)
の設定手順は `phase8-operations.md` を参照。

### 1. Secret Manager にシークレットを登録（初回のみ）

環境変数直書き（`--set-env-vars`）は`gcloud run services describe`やCloud Console、
デプロイログから平文で見えてしまうため使わない。必ずSecret Manager経由にする。

```bash
printf '%s' "xxxx" | gcloud secrets create livekit-api-key --data-file=-
printf '%s' "xxxx" | gcloud secrets create livekit-api-secret --data-file=-

# サービスアカウントJSON全体をそのままシークレットとして登録する
gcloud secrets create recording-gcs-credentials --data-file=recording-service-account.json

# Cloud RunのサービスアカウントにSecret Managerへのアクセス権を付与
gcloud secrets add-iam-policy-binding livekit-api-key \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding livekit-api-secret \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding recording-gcs-credentials \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

発行済みの `recording-service-account.json` はローカルに残さず削除するか、
`.gitignore` 済み(このリポジトリでは追加済み)であることを確認しておくこと。

**Firebase Admin SDK / Firestoreの認証情報について**: Cloud Run上ではサービス
アカウントキーの配置は不要。Cloud Runの実行サービスアカウントがApplication
Default Credentials経由で自動的に使われる。ただし、そのサービスアカウントが
対象のFirebase/Firestoreプロジェクトにアクセスできる必要があるため、通常は
Cloud RunプロジェクトとFirebaseプロジェクトを同一のGCPプロジェクトにしておくのが
最も簡単（別プロジェクトの場合は追加のIAM設定が必要）。

一方、`RECORDING_GCS_CREDENTIALS_JSON`(GCSアップロード用)はADCとは別経路の
専用サービスアカウントを明示的に使う設計にしているため、上記のADCとは別に
Secret Manager経由で渡す必要がある。

### 2. デプロイ

```bash
cd token-server
gcloud run deploy ptt-token-server \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-secrets LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest,RECORDING_GCS_CREDENTIALS_JSON=recording-gcs-credentials:latest \
  --set-env-vars LIVEKIT_HOST=https://your-project.livekit.cloud,FIREBASE_PROJECT_ID=your-firebase-project-id,ALLOWED_ORIGINS=https://ptt-client.example.com,RECORDING_GCS_BUCKET=your-recording-bucket
```

* `--allow-unauthenticated`は維持（Cloud Run自体のIAM認証はかけず、
  アプリケーションレイヤーでFirebase Authによる認証を行う設計のため。
  `/webhooks/livekit` もこの延長で、LiveKit独自の署名検証をアプリケーション
  レイヤーで行う）。
* `LIVEKIT_HOST` / `FIREBASE_PROJECT_ID` / `ALLOWED_ORIGINS` /
  `RECORDING_GCS_BUCKET` は秘匿情報ではないため `--set-env-vars`で問題ない。
* 過去に`--set-env-vars`で平文デプロイしたリビジョンが残っている場合、
  切り替え後に不要な旧リビジョンを削除すること（`gcloud run revisions list` → `gcloud run revisions delete`）。

### 3. LiveKit Webhookの登録

デプロイ後のCloud RunのURLを使い、LiveKit Cloud (Settings > Webhooks) に
以下を登録する:

```
https://ptt-token-server-xxxx.a.run.app/webhooks/livekit
```

登録後、`recording/start` → `recording/stop` を一度叩いてみて、サーバーの
ログに `[録音終了] room=... egressId=... status=...` が出力されることと、
GCSバケット(`gs://your-recording-bucket/recordings/<roomId>/...`)に
実際にファイルがアップロードされていることを確認する。**[Phase8]** 続けて
`GET /rooms/xxxx/recordings` で履歴に反映されていること、
`GET /rooms/xxxx/recordings/<EGRESS_ID>/download-url` でダウンロードURLが
発行できることも確認する。

## レート制限

`/token`には、IPベース(1分10回)と、認証後のuidベース(1分20回)の2段のレート
制限をかけている。IPベースは未認証段階での連打・スキャン対策、uidベースは
NAT配下で複数の正規ユーザーが同一IPになるケースを考慮して少し緩めにしている。

**[Phase8]** `/admin/audit-logs` / `/rooms/:roomId/recordings*` /
`/admin/admins*` には現状専用のレート制限をかけていない。悪用パターンが
見つかった場合は`uidRateLimiter`と同様の仕組みの追加を検討する
(下記「未実装・今後の検討事項」参照)。

## 動作確認チェックリスト

### 認証
- [ ] `Authorization`ヘッダーなしでどのAPIを叩いても`401`が返る
- [ ] 不正・期限切れのID Tokenで`401`が返る

### ルーム管理
- [ ] ルーム作成者が`owner`としてmembersに登録される
- [ ] 正しい招待コードで参加すると`members`に`role: member`で追加される
- [ ] 誤った招待コードでは`403`が返る
- [ ] 定員に達したルームへの新規参加が`403`になる
- [ ] メンバーでないユーザーが`/token`を叩くと`403`が返る
- [ ] BANされたユーザーが`/token`を叩くと`403`が返り、かつLiveKitからも切断される
- [ ] owner/moderator以外が`/ban`を叩くと`403`が返る
- [ ] ownerを対象に`/ban`を叩くと`403`が返る

### role変更(moderator任命)【Phase8】
- [ ] owner以外が`/role`を叩くと`403`が返る
- [ ] ownerがmemberをmoderatorに変更でき、`/admin/rooms/:roomId`のmembers一覧に反映される
- [ ] targetがownerの場合`403`、自分自身を対象にすると`400`、BAN済み対象だと`400`が返る
- [ ] role変更のたびに`auditLogs`へ`room:role_change`が記録される

### 送話ロック
- [ ] 誰もロックを持っていない状態で`/talk/start`を叩くと成功する
- [ ] 他人がロック保持中に`/talk/start`を叩くと`409 (talk_locked)`が返る
- [ ] `/talk/heartbeat`を呼び続ける限り、`MAX_HOLD_MS`まではロックを保持し続けられる
- [ ] `/talk/stop`後、別ユーザーが`/talk/start`を取得できる

### 録音(Egress)
- [ ] owner/moderator以外が`/recording/start`を叩くと`403`が返る
- [ ] 録音開始後、全参加者のRoomMetadataChangedに`recording.active: true`が伝播する
- [ ] 録音中に再度`/recording/start`を叩くと`409`が返る
- [ ] `/recording/stop`直後は`recording.active`がまだ`true`のままで、
      `egress_ended`のWebhook受信後に`false`へ確定する
- [ ] GCSバケット(`RECORDING_GCS_BUCKET`)に録音ファイルが実際にアップロードされる
- [ ] 署名が不正なWebhookリクエストは`401`で拒否される
- [ ] GCSアップロード用サービスアカウントに書き込み権限がない状態で開始すると、
      `/recording/start`が500を返し、Firestore側の`recording`が`null`に戻る
      (仮登録した状態が残らない)
- [ ] 開始/停止のたびに`auditLogs`へ`recording:start`/`recording:stop_requested`が記録される

### 録音履歴・ダウンロード【Phase8】
- [ ] メンバーが`GET /rooms/:roomId/recordings`で過去の録音履歴を取得できる
- [ ] メンバーでないユーザーが叩くと`403`が返る
- [ ] owner/moderator以外が`.../download-url`を叩くと`403`が返る
- [ ] 発行されたURLで実際にファイルがダウンロードでき、5分経過後は失敗する
- [ ] `egress_ended`受信後、`rooms/{roomId}/recordings/{egressId}`が正しく保存される
- [ ] ダウンロードURL発行のたびに`auditLogs`へ`recording:download_url_issued`が記録される

### 監査ログ【Phase8】
- [ ] `audit:read`権限を持たないユーザーが`/admin/audit-logs`を叩くと`403`が返る
- [ ] `?roomId=`/`?actorUid=`での絞り込みが正しく機能する(複合インデックス要デプロイ)
- [ ] `auditLogs`コレクションへクライアントSDKから直接読み書きしようとすると`firestore.rules`で拒否される

### 管理者権限【Phase8】
- [ ] `admins:manage`権限を持たないユーザーが`/admin/admins`系APIを叩くと`403`が返る
- [ ] `permission: "admins:manage"`を指定すると`403`が返る(このAPIでは変更不可)
- [ ] 権限付与/剥奪が成功し、対象ユーザーの該当API実行可否が変わる
- [ ] 付与/剥奪のたびに`auditLogs`へ`admin:grant`/`admin:revoke`が記録される

### 通報
- [ ] 通報が`reports`コレクションに`status: open`で保存される
- [ ] 自分自身への通報は`400`になる

### インフラ・データライフサイクル
- [ ] `ALLOWED_ORIGINS`に含まれないオリジンからのfetchがCORSエラーになる
- [ ] 同一IPから11回連続で`/token`を叩くと11回目以降が`429`になる
- [ ] クライアント(Web/iOS)から直接Firestoreの`rooms`/`members`/`reports`/
      `recordings`/`adminUsers`/`auditLogs`に書き込もうとすると、
      セキュリティルールで拒否される
- [ ] `gcloud run services describe ptt-token-server`の出力にAPIキーの値が平文で出てこない
- [ ] `recording-service-account.json`がリポジトリにコミットされていない
- [ ] `reports`/`auditLogs`のTTLポリシーが有効化されている(`phase8-operations.md`参照)
- [ ] GCSバケットのライフサイクルルールが設定されている(`phase8-operations.md`参照)

**Phase8の詳細な追加チェックリスト(TTL・GCSライフサイクル・インデックス等の
セットアップ手順とあわせて)は `phase8-operations.md` を参照。管理者
ダッシュボード(Vue版)側の確認項目は `admin-dashboard/README.md` の
「Phase 8 での追加」節を参照。**

## 未実装・今後の検討事項

- **Firebase App Check**: 本物のアプリ経由のリクエストであることを検証する
  仕組み。不特定多数への公開を想定する場合、スクリプトからの直接叩き・
  トークン乱発を防ぐために実質必須だが、クライアント側の追加実装
  (reCAPTCHA/DeviceCheck設定)が必要なため今回のスコープからは外している。
- **クライアント側UI(録音の開始/停止ボタン)**: 録音中インジケーターの表示は
  Web/iOSともに別途実装が必要(今回のスコープはサーバー側のAPIのみ)。
  録音履歴の一覧・ダウンロードは管理者ダッシュボード(Vue版)に実装済み
  (Phase8, `admin-dashboard/src/views/RoomDetailView.vue`)。
- **プッシュ通知**: 今後の実装対象。
- **Phase8で追加したAPI群への専用レート制限**: `/admin/audit-logs` /
  `/rooms/:roomId/recordings*` / `/admin/admins*` は現状`/token`のような
  IPベース/uidベースのレート制限をかけていない。悪用パターンが見つかった
  場合に`uidRateLimiter`相当の仕組みを追加する。
- **監査ログの全文検索**: 現状`roomId`/`actorUid`の完全一致絞り込みのみ。
  `action`や`detail`内での検索が必要になれば、BigQueryへのエクスポート等
  別の仕組みを検討する。
- **`admins:manage`自体のAPI化**: 現状`dev-tools/grant-admin-permission.js`
  経由の手動運用に固定している。「誰が新しい最上位管理者を任命できるか」を
  安全に(再帰的に)守る仕組みができるまではこの制約を維持する方針。
- **`events`コレクションの肥大化対策**: `reports`/`auditLogs`にはPhase8で
  TTLを導入したが、Phase4の`events`(Webhookログ)にはまだTTLを導入していない。
  同じ手順(`phase8-operations.md`参照)で追加できる。
