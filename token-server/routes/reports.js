/**
 * 通報受付API
 *
 * このエンドポイントは通報データの受付のみを行う。
 * 実際の対応(内容確認・BAN実行など)は、モデレーターがreportsコレクションを
 * 見て手動で POST /rooms/:roomId/members/:uid/ban を呼ぶ運用を想定している
 * (自動BANは誤通報・荒らしによる悪用のリスクがあるため、まずは人力運用から始める)。
 *
 * [Phase8] 書き込み時に expireAt をセットし、Firestore TTLポリシーで
 * 一定期間後に自動削除されるようにする(phase8-operations.md参照)。
 *
 * [Phase12] 通報者がroomIdのメンバーであることを検証する。
 * このルーターは`/reports`直下にマウントされておりroomIdはbodyから来るため
 * (`server.js`参照)、req.paramsを前提とする既存の`requireRoomMembership`
 * ミドルウェアはそのまま使えない。そのため同等の判定(メンバー存在確認・
 * BAN済みでないこと)をこのファイル内で行う。以前は`requireFirebaseAuth`のみ
 * で、ログイン済みであれば対象roomのメンバーでなくても任意のroomId/
 * reportedUidで通報できてしまっていた
 * (phase12-role-operation-inventory.md 1章「気づいた点」)。
 */

const express = require('express');
const { db } = require('../lib/firebaseAdmin');
const { requireFirebaseAuth, isValidRoomId } = require('../middleware/requireAuth');

const router = express.Router();

const MAX_REASON_LENGTH = 1000;
const REPORT_RETENTION_DAYS = 180;

/**
 * POST /reports
 * body: { roomId, reportedUid, reason }
 */
router.post('/', requireFirebaseAuth, async (req, res) => {
  const reporterUid = req.firebaseUser.uid;
  const { roomId, reportedUid, reason } = req.body || {};

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }
  if (!reportedUid || typeof reportedUid !== 'string') {
    return res.status(400).json({ error: 'reportedUid は必須です' });
  }
  if (!reason || typeof reason !== 'string') {
    return res.status(400).json({ error: 'reason は必須です' });
  }
  if (reportedUid === reporterUid) {
    return res.status(400).json({ error: '自分自身を通報することはできません' });
  }

  try {
    const reporterMemberSnap = await db.doc(`rooms/${roomId}/members/${reporterUid}`).get();
    if (!reporterMemberSnap.exists) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }
    if (reporterMemberSnap.data().status === 'banned') {
      return res.status(403).json({ error: 'このルームから排除されています' });
    }
  } catch (e) {
    console.error('[通報受付: メンバーシップ確認エラー]', e.message);
    return res.status(500).json({ error: 'メンバーシップの確認に失敗しました' });
  }

  try {
    const now = new Date();
    const reportRef = await db.collection('reports').add({
      reporterUid,
      reportedUid,
      roomId,
      reason: reason.slice(0, MAX_REASON_LENGTH),
      createdAt: now,
      expireAt: new Date(now.getTime() + REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      status: 'open',
    });
    console.log(`[通報受付] reportId=${reportRef.id} roomId=${roomId} reporter=${reporterUid}`);
    res.status(201).json({ reportId: reportRef.id });
  } catch (e) {
    console.error('[通報受付エラー]', e.message);
    res.status(500).json({ error: '通報の受付に失敗しました' });
  }
});

module.exports = router;
