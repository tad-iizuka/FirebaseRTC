# ptt-token-server

`ptt-server/server.js`（WS制御 + Opusミキシング）の後継。
LiveKit接続用のJWTを発行するだけの軽量サーバー。

## ローカル動作確認

```bash
cd token-server
npm install
cp .env.example .env
# .env に LIVEKIT_API_KEY / LIVEKIT_API_SECRET を記入
node -r dotenv/config server.js   # dotenvが無ければ export で環境変数を渡してもOK
```

別ターミナルで:

```bash
curl "http://localhost:8080/token?room=room1&identity=alice"
# => {"token":"eyJhbGciOi...", "room":"room1", "identity":"alice"}
```

返ってきた `token` と、LiveKit CloudのプロジェクトURL（`wss://xxxx.livekit.cloud`）を使って
Web/iOSクライアントから `room.connect(url, token)` できるか確認する。

<<<<<<< HEAD
## Cloud Runへのデプロイ

### 1. Secret Manager にシークレットを登録（初回のみ）

環境変数直書き（`--set-env-vars`）は`gcloud run services describe`やCloud Console、
デプロイログから平文で見えてしまうため使わない。必ずSecret Manager経由にする。

```bash
printf '%s' "xxxx" | gcloud secrets create livekit-api-key --data-file=-
printf '%s' "xxxx" | gcloud secrets create livekit-api-secret --data-file=-

# Cloud RunのサービスアカウントにSecret Managerへのアクセス権を付与
# (PROJECT_NUMBERは `gcloud projects describe <PROJECT_ID> --format='value(projectNumber)'` で確認)
gcloud secrets add-iam-policy-binding livekit-api-key \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding livekit-api-secret \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

キーをローテーションする場合は`gcloud secrets versions add livekit-api-key --data-file=-`で新バージョンを追加する。

### 2. デプロイ（`--set-secrets` でシークレットを注入）
=======
## Cloud Runへのデプロイ（既存ptt-serverと同じ要領）
>>>>>>> e37d4c73c5b4295d0062497426a252a8e9c282f4

```bash
cd token-server
gcloud run deploy ptt-token-server \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
<<<<<<< HEAD
  --set-secrets LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest
```

* `--allow-unauthenticated`は維持（クライアントは事前認証なしで`/token`を叩く設計のため）。
  そのぶん、大量発行対策として`/token`にレート制限を実装済み（下記参照）。
* シークレットは環境変数として注入されるだけで、ログやサービス設定のYAMLに値そのものは出力されない。
* 過去に`--set-env-vars`で平文デプロイしたリビジョンが残っている場合、
  切り替え後に不要な旧リビジョンを削除すること（`gcloud run revisions list` → `gcloud run revisions delete`）。

## レート制限（実装済み）

`/token`に`express-rate-limit`によるIPベースのレート制限を追加済み（1IPあたり1分間10リクエストまで）。
超過時は`429 Too Many Requests`を返す。

* Cloud RunはGoogle Front Endを1段経由するため、`app.set('trust proxy', 1)`を設定して
  `req.ip`が実クライアントIPになるようにしている。これがないと全リクエストが
  プロキシの同一IP扱いになり、レート制限が機能しない。
* 現状はIP単位。閾値（1分10回）はプロトタイプ向けの暫定値のため、実運用の接続頻度に応じて調整する。
=======
  --set-env-vars LIVEKIT_API_KEY=xxxx,LIVEKIT_API_SECRET=xxxx
```

* `--allow-unauthenticated` はプロトタイプ用。本番では認証やレート制限を検討すること。
* シークレットは環境変数直書きではなく Secret Manager 経由推奨（`--set-secrets`）。
>>>>>>> e37d4c73c5b4295d0062497426a252a8e9c282f4

## 動作確認チェックリスト

- [ ] `/token` が room・identityごとに異なるJWTを返す
- [ ] 発行したJWTでWeb版から`room.connect()`が成功する
- [ ] 同じJWTでiOS版からも`room.connect()`が成功する
- [ ] 存在しないroom名でも新規ルームとして自動作成される（LiveKitの既定動作）
<<<<<<< HEAD
- [ ] 同一IPから11回連続で`/token`を叩くと11回目以降が`429`になる
- [ ] `gcloud run services describe ptt-token-server`の出力にAPIキーの値が平文で出てこない
=======
>>>>>>> e37d4c73c5b4295d0062497426a252a8e9c282f4
