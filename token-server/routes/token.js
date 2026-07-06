/**
 * LiveKitトークン発行API
 *
 * [フェーズ2] ルーム参加制御の追加により、以前は「認証済みなら誰でも
 * 好きなroomのトークンを取得できた」状態から、「対象ルームのメンバー
 * (かつBANされていない)ことを確認した上でのみ発行する」状態に変更した。
 * メンバーシップの確立(=招待コード検証)は routes/rooms.js の
 * POST /rooms/:roomId/join が担当する。
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { AccessToken } = require('livekit-server-sdk');
const { db } = require('../lib/firebaseAdmin');
const { requireFirebaseAuth, isValidRoomId } = require('../middleware/requireAuth');

const router = express.Router();

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

// IPベース: 未認証段階でのトークンエンドポイント連打・スキャンを防ぐ第一防波堤。
const ipRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。しばらく待ってから再試行してください' },
  keyGenerator: (req) => req.ip,
});

// uidベース: 認証済みユーザー単位でも制限する。NAT配下の複数ユーザーが
// 同一IPになるケースでIP制限だけだと正規ユーザーを巻き込むため、
// こちらは少し余裕を持たせた閾値にしている。
const uidRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。しばらく待ってから再試行してください' },
  keyGenerator: (req) => req.firebaseUser?.uid || req.ip,
});

/**
 * GET /token?room=roomId
 * Header: Authorization: Bearer <Firebase ID Token>
 */
router.get('/', ipRateLimiter, requireFirebaseAuth, uidRateLimiter, async (req, res) => {
  const room = String(req.query.room || '').trim();
  const uid = req.firebaseUser.uid;

  if (!isValidRoomId(room)) {
    return res.status(400).json({ error: 'room が不正です' });
  }

  try {
    const memberSnap = await db.doc(`rooms/${room}/members/${uid}`).get();
    if (!memberSnap.exists) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }
    const member = memberSnap.data();
    if (member.status === 'banned') {
      return res.status(403).json({ error: 'このルームから排除されています' });
    }

    const displayName = member.displayName || req.firebaseUser.email || uid;

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: uid,
      name: displayName,
      ttl: '10m',
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });

    const token = await at.toJwt();
    console.log(`[token発行] room=${room} identity=${uid}`);
    res.json({ token, room, identity: uid });
  } catch (e) {
    console.error('[token発行エラー]', e.message);
    res.status(500).json({ error: 'トークン発行に失敗しました' });
  }
});

module.exports = router;
