/**
 * PTT Token Server
 *
 * 役割はこれだけ:
 *   room + identity を受け取り、LiveKitに接続するためのJWTを発行する。
 * 実際のメディア転送(音声のSFU中継)はLiveKitサーバー側が担当するので、
 * このサーバーはWebSocketもOpusも一切扱わない。
 *
 * 旧 ptt-server/server.js (join/leave/ptt_start/ptt_end のWS制御 + Opusミキシング)
 * はLiveKitサーバー本体に役割が移り、廃止される。
 */

const express = require('express');
const { AccessToken } = require('livekit-server-sdk');

const PORT = process.env.PORT || 8080;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('[起動エラー] LIVEKIT_API_KEY / LIVEKIT_API_SECRET が未設定です');
  process.exit(1);
}

const app = express();

// [CORS] Web版クライアント(ptt-client)からのクロスオリジンfetchを許可。
// 本番では allowedOrigins を実際のホスティング先ドメインに絞ること。
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Cloud Run のヘルスチェック用
app.get('/', (req, res) => res.send('ptt-token-server OK'));

/**
 * GET /token?room=room1&identity=alice
 *
 * room  : 入室するルームID (旧プロトコルのroomIdに相当)
 * identity : クライアントの識別子 (旧プロトコルのclientIdに相当)
 *
 * 同一identityで既に接続中の場合、LiveKit側の既定動作として
 * 古い接続が切断され新しい接続に置き換わる(重複joinエラーは発生しない)。
 */
app.get('/token', async (req, res) => {
  const room = String(req.query.room || '').trim();
  const identity = String(req.query.identity || '').trim();

  if (!room || !identity) {
    return res.status(400).json({ error: 'room と identity は必須です' });
  }

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      ttl: '10m', // 接続後は毎回の再取得不要。切れる前に再接続するなら短めでOK
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true, // 将来talker状態などをdata channelで送る場合用
    });

    const token = await at.toJwt();
    console.log(`[token発行] room=${room} identity=${identity}`);
    res.json({ token, room, identity });
  } catch (e) {
    console.error('[token発行エラー]', e.message);
    res.status(500).json({ error: 'トークン発行に失敗しました' });
  }
});

app.listen(PORT, () => {
  console.log(`ptt-token-server listening on :${PORT}`);
});
