/**
 * routes/internal.js
 *
 * [開始/終了時刻] 「変更(管理者によるスケジュール編集)はリアルタイム、
 * 自然経過(何もしなくても時刻が来たら終わる)はポーリングでよい」という
 * 方針に基づき、この内部エンドポイントをCloud Scheduler等から定期的
 * (1分間隔程度を想定)に叩いてもらうことで、能動的な終了処理を実現する。
 *
 * 管理者による明示的な変更(routes/admin.js の PATCH .../schedule)側は、
 * その場で同期的に lib/roomSchedule.js#expireRoom を呼んでいるため、
 * このsweepは「誰も操作しないまま自然に終了時刻を迎えたRoom」の
 * 取りこぼしを拾う役割に限定される。
 *
 * 認証は middleware/requireInternalSecret.js 参照。
 */

const express = require('express');
const { db, admin } = require('../lib/firebaseAdmin');
const { expireRoom } = require('../lib/roomSchedule');
const { requireInternalSecret } = require('../middleware/requireInternalSecret');

const router = express.Router();

// 1回のsweepで処理するRoom数の上限。Cloud Schedulerの実行間隔(1分程度)より
// 処理が長引いて重複起動しないよう、安全弁として上限を設けておく。
const SWEEP_BATCH_LIMIT = 200;

/**
 * POST /internal/rooms/sweep-expired
 *
 * schedule.end を過ぎていて、まだ expireRoom() が実行されていない
 * (schedule.expiredAt が未設定の)Roomを検索し、順に expireRoom() を呼ぶ。
 *
 * [クエリ制約についての注記] Firestoreの複合クエリ制約上、
 * 「end <= now」と「expiredAtが存在しない」を1クエリで両立させるのは
 * 素直ではないため、ここでは「end <= now」で候補を絞り込んだ後、
 * expireRoom() 内部の冪等チェック(schedule.expiredAtが既にあれば即return)に
 * 任せる設計とする。件数が増えてきた場合はスケジュールされたRoom専用の
 * 別コレクション/インデックスへ切り出す最適化を検討する。
 */
router.post('/rooms/sweep-expired', requireInternalSecret, async (req, res) => {
  const now = admin.firestore.Timestamp.now();

  try {
    const snap = await db
      .collection('rooms')
      .where('schedule.end', '<=', now)
      .limit(SWEEP_BATCH_LIMIT)
      .get();

    const targets = snap.docs.filter((doc) => !doc.data().schedule?.expiredAt);

    const results = await Promise.allSettled(targets.map((doc) => expireRoom(doc.id)));
    const failed = results.filter((r) => r.status === 'rejected');
    failed.forEach((r, i) => {
      console.error(`[sweep-expired] expireRoom失敗 room=${targets[i].id}: ${r.reason?.message}`);
    });

    console.log(`[sweep-expired] scanned=${snap.size} processed=${targets.length} failed=${failed.length}`);
    res.json({ scanned: snap.size, processed: targets.length, failed: failed.length });
  } catch (e) {
    console.error('[sweep-expiredエラー]', e.message);
    res.status(500).json({ error: 'sweep処理に失敗しました' });
  }
});

module.exports = router;
