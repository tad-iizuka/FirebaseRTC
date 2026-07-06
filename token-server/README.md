# ptt-token-server

`ptt-server/server.js`（WS制御 + Opusミキシング）の後継。
当初は「Firebase AuthのID Tokenを検証してLiveKitのJWTを発行するだけ」の
軽量サーバーだったが、招待制ルーム管理・BAN・通報機能の追加により、
実質的に「ルーム管理を持つ小さなバックエンド」に拡張されている。

## アーキテクチャ

```
lib/firebaseAdmin.js   … Firebase Admin SDK初期化 (db, auth を export)
middleware/requireAuth.js … ID Token検証ミドルウェア、roomIdバリデーション
routes/rooms.js         … ルーム作成 / 招待コードでの参加 / BAN
routes/token.js         … メンバーシップ確認付きLiveKitトークン発行
routes/reports.js       … 通報受付
server.js               … 上記をマウントするエントリーポイント
firestore.rules         … クライアントからの直接書き込み禁止ルール
```

## 認証・認可の設計

### 認証: Firebase Auth
`Authorization: Bearer <Firebase ID Token>` を全エンドポイント共通で必須とする。
Firebase Admin SDK (`admin.auth().verifyIdToken()`) で検証し、得られる `uid` を
以後の全ての処理で「そのユーザー本人」として扱う。クライアントが自己申告する
identity・uid相当の値は一切信用しない。

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

rooms/{roomId}/members/{uid}
  - role: "owner" | "moderator" | "member"
  - displayName: string
  - status: "active" | "banned"
  - joinedAt: timestamp

reports/{reportId}
  - reporterUid, reportedUid, roomId, reason, status, createdAt
```

**クライアントからFirestoreへの直接書き込みは一切許可しない**（`firestore.rules`参照）。
ルーム作成・参加・BANは全てこのサーバーのAPI（Admin SDK経由）でのみ行われる。
例外として、自分自身の `members/{uid}` ドキュメントの読み取りだけはクライアントに
許可している。これはリアルタイムリスナーで「自分がBANされたこと」を即座に
UIへ反映するための補助であり、BAN自体の強制力はLiveKit側の即時キックが担う。

## API一覧

| Method | Path | 認証 | 説明 |
|---|---|---|---|
| GET | `/` | 不要 | ヘルスチェック |
| POST | `/rooms` | 必須 | ルーム作成。呼び出しユーザーがownerになる。招待コードを返す |
| POST | `/rooms/:roomId/join` | 必須 | 招待コードを検証しmembersに追加 |
| GET | `/token?room=roomId` | 必須 | メンバーシップ確認後、LiveKit接続用JWTを発行 |
| POST | `/rooms/:roomId/members/:targetUid/ban` | 必須(owner/moderatorのみ) | BAN化 + LiveKitから即時キック |
| POST | `/reports` | 必須 | 通報の受付(対応は人力運用) |

### なぜBANはFirestore書き換えだけで済まないのか

`AccessToken` のTTLは10分に設定している。Firestoreの `status` を `banned` に
書き換えただけでは、対象ユーザーが既に持っているLiveKitトークン・接続そのものは
有効なままのため、最大10分間は接続し続けられてしまう。これを避けるため、
BAN処理では `RoomServiceClient.removeParticipant()` を同時に呼び、
その場でLiveKitの接続を物理的に切断する。

### 通報機能の運用について

`POST /reports` はデータの受付のみを行う。自動BANは誤通報・荒らしによる
悪用のリスクがあるため実装しておらず、モデレーターが `reports` コレクションを
確認した上で手動で `/rooms/:roomId/members/:targetUid/ban` を呼ぶ運用を想定している。

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
```

## Firestoreセキュリティルールのデプロイ

```bash
firebase deploy --only firestore:rules
```

（Firebase CLIのセットアップ、`firebase.json`でのfirestore.rulesパス指定は別途必要）

## Cloud Runへのデプロイ

### 1. Secret Manager にシークレットを登録（初回のみ）

環境変数直書き（`--set-env-vars`）は`gcloud run services describe`やCloud Console、
デプロイログから平文で見えてしまうため使わない。必ずSecret Manager経由にする。

```bash
printf '%s' "xxxx" | gcloud secrets create livekit-api-key --data-file=-
printf '%s' "xxxx" | gcloud secrets create livekit-api-secret --data-file=-

# Cloud RunのサービスアカウントにSecret Managerへのアクセス権を付与
gcloud secrets add-iam-policy-binding livekit-api-key \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding livekit-api-secret \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Firebase Admin SDK / Firestoreの認証情報について**: Cloud Run上ではサービス
アカウントキーの配置は不要。Cloud Runの実行サービスアカウントがApplication
Default Credentials経由で自動的に使われる。ただし、そのサービスアカウントが
対象のFirebase/Firestoreプロジェクトにアクセスできる必要があるため、通常は
Cloud RunプロジェクトとFirebaseプロジェクトを同一のGCPプロジェクトにしておくのが
最も簡単（別プロジェクトの場合は追加のIAM設定が必要）。

### 2. デプロイ

```bash
cd token-server
gcloud run deploy ptt-token-server \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-secrets LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest \
  --set-env-vars LIVEKIT_HOST=https://your-project.livekit.cloud,FIREBASE_PROJECT_ID=your-firebase-project-id,ALLOWED_ORIGINS=https://ptt-client.example.com
```

* `--allow-unauthenticated`は維持（Cloud Run自体のIAM認証はかけず、
  アプリケーションレイヤーでFirebase Authによる認証を行う設計のため）。
* `LIVEKIT_HOST` / `FIREBASE_PROJECT_ID` / `ALLOWED_ORIGINS` は秘匿情報ではないため`--set-env-vars`で問題ない。
* 過去に`--set-env-vars`で平文デプロイしたリビジョンが残っている場合、
  切り替え後に不要な旧リビジョンを削除すること（`gcloud run revisions list` → `gcloud run revisions delete`）。

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

### 通報
- [ ] 通報が`reports`コレクションに`status: open`で保存される
- [ ] 自分自身への通報は`400`になる

### インフラ
- [ ] `ALLOWED_ORIGINS`に含まれないオリジンからのfetchがCORSエラーになる
- [ ] 同一IPから11回連続で`/token`を叩くと11回目以降が`429`になる
- [ ] クライアント(Web/iOS)から直接Firestoreの`rooms`/`members`/`reports`に
      書き込もうとすると、セキュリティルールで拒否される
- [ ] `gcloud run services describe ptt-token-server`の出力にAPIキーの値が平文で出てこない

## 未実装・今後の検討事項

- **Firebase App Check**: 本物のアプリ経由のリクエストであることを検証する
  仕組み。不特定多数への公開を想定する場合、スクリプトからの直接叩き・
  トークン乱発を防ぐために実質必須だが、クライアント側の追加実装
  (reCAPTCHA/DeviceCheck設定)が必要なため今回のスコープからは外している。
- **クライアント側UI**: ルーム作成・招待リンク共有・参加・メンバー管理・
  通報の各画面はこのAPIを叩く形で別途実装が必要（今回のスコープはサーバー側の
  データモデル・APIのみ）。
- **moderator権限の付与手段**: 現状ownerがmoderatorを任命するAPIが存在しない。
  必要になれば`/rooms/:roomId/members/:targetUid/role`のようなエンドポイントを追加する。
