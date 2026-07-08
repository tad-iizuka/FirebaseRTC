/**
 * テキストチャットAPI (Phase 5)
 *
 * [設計方針]
 * LiveKitのData Channelは使わない。Data Channelはサーバーを経由せず
 * クライアント間で直接ブロードキャストされるため、
 *   - 送信前のモデレーション(NGワード等、将来必要になった場合)ができない
 *   - 途中参加者への履歴配信ができない
 *   - BANされたユーザーの読み取り遮断ができない(ban.js/firestore.rulesの
 *     仕組みと二重に強制力を持たせられない)
 * という欠点がある。そのため、書き込みは必ずこのAPI(Admin SDK経由)を通し、
 * Firestoreの `rooms/{roomId}/messages` を正とする。配信はクライアント側の
 * Firestoreリアルタイムリスナー(onSnapshot)に任せる
 * (routes/rooms.jsのBAN即時反映と全く同じ設計パターン)。
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../lib/firebaseAdmin');
const { requireFirebaseAuth, requireRoomMembership } = require('../middleware/requireAuth');

const router = express.Router();

const MAX_TEXT_LENGTH = 2000;

// uidベース: token.jsのuidRateLimiterと同じ考え方(NAT配下の正規ユーザーを
// 巻き込みすぎない程度の閾値)。チャットは連投されやすいため少し広めにしている。
const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'メッセージの送信が多すぎます。しばらく待ってから再試行してください' },
  keyGenerator: (req) => req.firebaseUser?.uid || req.ip,
});

/**
 * POST /rooms/:roomId/messages
 * body: { text: string }
 *
 * requireRoomMembership を通すことで、BANされたユーザーは送信もできない
 * (routes/talk.js と同じミドルウェア共有)。
 */
router.post(
  '/:roomId/messages',
  requireFirebaseAuth,
  requireRoomMembership,
  chatRateLimiter,
  async (req, res) => {
    const uid = req.firebaseUser.uid;
    const { roomId } = req.params;
    const text = String(req.body?.text || '').trim();

    if (!text) {
      return res.status(400).json({ error: 'text は必須です' });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `メッセージは${MAX_TEXT_LENGTH}文字以内にしてください` });
    }

    try {
      const displayName = req.roomMember.displayName || req.firebaseUser.email || uid;
      const messageRef = await db
        .collection('rooms')
        .doc(roomId)
        .collection('messages')
        .add({
          uid,
          displayName,
          text,
          createdAt: new Date(),
        });

      console.log(`[chat送信] room=${roomId} uid=${uid} messageId=${messageRef.id}`);
      res.status(201).json({ messageId: messageRef.id });
    } catch (e) {
      console.error('[chat送信エラー]', e.message);
      res.status(500).json({ error: 'メッセージの送信に失敗しました' });
    }
  }
);

module.exports = router;
