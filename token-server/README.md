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

## Cloud Runへのデプロイ（既存ptt-serverと同じ要領）

```bash
cd token-server
gcloud run deploy ptt-token-server \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars LIVEKIT_API_KEY=xxxx,LIVEKIT_API_SECRET=xxxx
```

* `--allow-unauthenticated` はプロトタイプ用。本番では認証やレート制限を検討すること。
* シークレットは環境変数直書きではなく Secret Manager 経由推奨（`--set-secrets`）。

## 動作確認チェックリスト

- [ ] `/token` が room・identityごとに異なるJWTを返す
- [ ] 発行したJWTでWeb版から`room.connect()`が成功する
- [ ] 同じJWTでiOS版からも`room.connect()`が成功する
- [ ] 存在しないroom名でも新規ルームとして自動作成される（LiveKitの既定動作）
