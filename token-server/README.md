# ptt-token-server

`ptt-server/server.js`（WS制御 + Opusミキシング）の後継。
当初は「Firebase AuthのID Tokenを検証してLiveKitのJWTを発行するだけ」の
軽量サーバーだったが、招待制ルーム管理・BAN・通報機能・送話ロック・
録音(Egress)機能の追加により、実質的に「ルーム管理を持つ小さなバックエンド」に
拡張されている。

## アーキテクチャ

```
lib/firebaseAdmin.js   … Firebase Admin SDK初期化 (db, auth を export)
lib/roomMetadata.js     … LiveKit Room Metadataへの書き込みを一箇所に集約
                          (talkLock/recordingの状態を合成して同期する) [Phase5で追加]
middleware/requireAuth.js … ID Token検証ミドルウェア、roomIdバリデーション
routes/rooms.js         … ルーム作成 / 招待コードでの参加 / BAN
routes/token.js         … メンバーシップ確認付きLiveKitトークン発行
routes/reports.js       … 通報受付
routes/talk.js          … 送話ロック(排他制御) [Phase 2で追加]
routes/recording.js     … 録音(Egress)の開始/停止/状態取得。保存先はGCS [Phase5で追加]
routes/webhooks.js      … LiveKit Webhook受信(Egress終了イベントの確定処理) [Phase5で追加]
server.js               … 上記をマウントするエントリーポイント
firestore.rules         … クライアントからの直接書き込み禁止ルール
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

reports/{reportId}
  - reporterUid, reportedUid, roomId, reason, status, createdAt
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
| POST | `/rooms/:roomId/talk/start` | 必須(メンバーのみ) | 発話ロックの取得 |
| POST | `/rooms/:roomId/talk/heartbeat` | 必須(メンバーのみ) | 発話ロックの延長 |
| POST | `/rooms/:roomId/talk/stop` | 必須(メンバーのみ) | 発話ロックの解放 |
| POST | `/rooms/:roomId/recording/start` | 必須(owner/moderatorのみ) | 録音(Egress)を開始。保存先はGCS |
| POST | `/rooms/:roomId/recording/stop` | 必須(owner/moderatorのみ) | 録音の停止を依頼(確定はWebhook側) |
| GET | `/rooms/:roomId/recording/status` | 必須(メンバーのみ) | 現在の録音状態を取得 |
| POST | `/webhooks/livekit` | LiveKit署名検証 | LiveKitからのWebhook受信(Egress終了等) |
| POST | `/reports` | 必須 | 通報の受付(対応は人力運用) |

### なぜBANはFirestore書き換えだけで済まないのか

`AccessToken` のTTLは10分に設定している。Firestoreの `status` を `banned` に
書き換えただけでは、対象ユーザーが既に持っているLiveKitトークン・接続そのものは
有効なままのため、最大10分間は接続し続けられてしまう。これを避けるため、
BAN処理では `RoomServiceClient.removeParticipant()` を同時に呼び、
その場でLiveKitの接続を物理的に切断する。

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

# ownerが録音を開始
curl -X POST "http://localhost:8080/rooms/xxxx/recording/start" \
  -H "Authorization: Bearer $TOKEN"

# ownerが録音の停止を依頼(この時点ではまだactiveのまま。egress_endedのWebhookで確定する)
curl -X POST "http://localhost:8080/rooms/xxxx/recording/stop" \
  -H "Authorization: Bearer $TOKEN"
```

ローカル環境ではLiveKitからのWebhookを直接受け取れないため、`ngrok` 等で
一時的に公開URLを払い出し、LiveKit Cloud の Webhook設定に登録すると
`egress_ended` の受信まで含めて動作確認できる。

## Firestoreセキュリティルールのデプロイ

リポジトリルートに `firebase.json` と `firestore.rules` を追加済み。
初回のみプロジェクトを紐付けてから、通常のデプロイコマンドでルールを反映する。

```bash
# リポジトリルートで実行
firebase use --add   # 対象のFirebaseプロジェクトを選択・.firebaserc生成(初回のみ)
firebase deploy --only firestore:rules
```

デプロイ後、`rooms`・`rooms/{roomId}/members`・`reports` への直接書き込みが
クライアントSDKから一切できなくなっていることを確認する
(下の動作確認チェックリストの該当項目を参照)。

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
登録する(下記手順1)。

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
実際にファイルがアップロードされていることを確認する。

## レート制限

`/token`には、IPベース(1分10回)と、認証後のuidベース(1分20回)の2段のレート
制限をかけている。IPベースは未認証段階での連打・スキャン対策、uidベースは
NAT配下で複数の正規ユーザーが同一IPになるケースを考慮して少し緩めにしている。

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

### 通報
- [ ] 通報が`reports`コレクションに`status: open`で保存される
- [ ] 自分自身への通報は`400`になる

### インフラ
- [ ] `ALLOWED_ORIGINS`に含まれないオリジンからのfetchがCORSエラーになる
- [ ] 同一IPから11回連続で`/token`を叩くと11回目以降が`429`になる
- [ ] クライアント(Web/iOS)から直接Firestoreの`rooms`/`members`/`reports`に
      書き込もうとすると、セキュリティルールで拒否される
- [ ] `gcloud run services describe ptt-token-server`の出力にAPIキーの値が平文で出てこない
- [ ] `recording-service-account.json`がリポジトリにコミットされていない

## 未実装・今後の検討事項

- **Firebase App Check**: 本物のアプリ経由のリクエストであることを検証する
  仕組み。不特定多数への公開を想定する場合、スクリプトからの直接叩き・
  トークン乱発を防ぐために実質必須だが、クライアント側の追加実装
  (reCAPTCHA/DeviceCheck設定)が必要なため今回のスコープからは外している。
- **クライアント側UI**: 録音の開始/停止ボタン、録音中インジケーターの表示は
  Web/iOSともに別途実装が必要（今回のスコープはサーバー側のAPIのみ）。
- **moderator権限の付与手段**: 現状ownerがmoderatorを任命するAPIが存在しない。
  必要になれば`/rooms/:roomId/members/:targetUid/role`のようなエンドポイントを追加する。
- **録音ファイルの一覧・ダウンロードAPI**: 現状はGCSに保存されるのみで、
  アプリ側から録音一覧を取得するAPIは未実装。運用初期はCloud Consoleから
  直接確認する想定。GCS側で署名付きURL(Signed URL)を発行するAPIを追加すれば、
  アプリから直接ダウンロードリンクを提示できる。
- **録音データのライフサイクル管理**: 現状バケットのライフサイクルルールは
  未設定。長期運用する場合は一定期間後に自動削除/Coldlineへ移行するGCSの
  ライフサイクルルールの設定を検討する。
- **テキストチャット・プッシュ通知・複数ルーム監視ダッシュボード**: Phase5の
  残り機能。今後の実装対象。
