/**
 * PTT Token Server — エントリーポイント
 *
 * 役割:
 *   1. Firebase AuthのID Tokenを検証する (全エンドポイント共通)
 *   2. ルームの作成・招待コードによる参加・BAN・通報受付を管理する (routes/rooms.js, routes/reports.js)
 *   3. ルームのメンバーであることを確認した上でLiveKit接続用JWTを発行する (routes/token.js)
 *
 * [経緯]
 * 旧 ptt-server/server.js (WS制御 + Opusミキシング) はLiveKitサーバー本体に
 * 役割が移り廃止された。その後継として作られたこのサーバーも、当初は
 * 「認証なしでトークンだけ発行する」役割だったが、
 *   フェーズ1: Firebase Authによるなりすまし防止
 *   フェーズ2: 招待制ルーム管理・BAN・通報機能
 * を経て、実質的に「ルーム管理を持つ小さなバックエンド」に拡張されている。
 */

const express = require('express');

require('./lib/firebaseAdmin'); // 初期化を実行するためにrequire (副作用目的)

const roomsRouter = require('./routes/rooms');
const tokenRouter = require('./routes/token');
const reportsRouter = require('./routes/reports');

const PORT = process.env.PORT || 8080;

// カンマ区切りで許可オリジンを指定 (例: "https://ptt-client.example.com")
// 未設定時は空配列 = ブラウザからのクロスオリジンfetchは全て拒否される(安全側のデフォルト)。
// iOSアプリはOriginヘッダーを送らないため、この設定の影響を受けない。
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
  console.error('[起動エラー] LIVEKIT_API_KEY / LIVEKIT_API_SECRET が未設定です');
  process.exit(1);
}
if (!process.env.LIVEKIT_HOST) {
  console.error('[起動エラー] LIVEKIT_HOST が未設定です (BAN時の即時キックに使用するLiveKit管理APIのhttps URL)');
  process.exit(1);
}
if (ALLOWED_ORIGINS.length === 0) {
  console.warn('[警告] ALLOWED_ORIGINS が未設定です。Webクライアントからのアクセスは全て拒否されます');
}

const app = express();

// Cloud Run はリバースプロキシ(GFE)を1段経由するため、
// これを設定しないと req.ip が常にプロキシのIP(=全リクエスト同一IP)になり、
// IPベースのレート制限が機能しない。
app.set('trust proxy', 1);

app.use(express.json());

// [CORS] ホワイトリスト化。ptt-client(Web版)の実ドメインのみ許可する。
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Cloud Run のヘルスチェック用 (認証不要)
app.get('/', (req, res) => res.send('ptt-token-server OK'));

app.use('/rooms', roomsRouter);
app.use('/token', tokenRouter);
app.use('/reports', reportsRouter);

app.listen(PORT, () => {
  console.log(`ptt-token-server listening on :${PORT}`);
});
