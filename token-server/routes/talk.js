/**
 * 送話ロックAPI (Phase 2: 排他制御)
 *
 * [設計方針]
 * 「誰か1人が話している間は他の人が発話できない」を、クライアント側のUI抑制
 * (talkersセットを見てボタンをdisableするだけ)ではなく、サーバー側の
 * Firestoreトランザクションで実効的に強制する。
 *
 * ロックは rooms/{roomId} ドキュメントの talkLock フィールドに持たせる:
 *   talkLock: { uid, acquiredAt, expiresAt }
 *
 * 取得・延長・解放のたびに、LiveKitのRoom Metadataへも同じ状態を書き込み、
 * 接続中の全クライアントに RoomMetadataChanged イベントとしてリアルタイムに
 * 伝播させる(クライアント側に別途Firestoreリスナーを組み込む必要をなくすため)。
 *
 * [将来のSTT連携を見据えて]
 * currentTalker (uid) を単一の値としてサーバーが常に把握できる状態にしておくことで、
 * 将来LiveKit EgressやサーバーサイドでのTrack購読から音声を拾ってSTTにかける際、
 * 「今の音声区間が誰の発話か」を迷わず紐付けられるようにしている。
 */

const express = require('express');
const { RoomServiceClient } = require('livekit-server-sdk');
const { db } = require('../lib/firebaseAdmin');
const { requireFirebaseAuth, requireRoomMembership } = require('../middleware/requireAuth');

const router = express.Router();

const roomService = new RoomServiceClient(
  process.env.LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

// ロックのTTL。heartbeatで延長されない限りこの秒数で自動失効する
// (アプリkill・ネットワーク切断等でstopが呼ばれなかった場合の安全弁)。
const LOCK_TTL_MS = 15 * 1000;

// 1回の発話で連続して保持できる最大時間。長時間の占有を防ぐため、
// heartbeatを受け付けてもacquiredAtからこの時間を超えたら強制的に解放させる。
const MAX_HOLD_MS = 60 * 1000;

function nowMs() {
  return Date.now();
}

function isStale(talkLock, at) {
  if (!talkLock) return true;
  if (talkLock.expiresAt.toMillis() <= at) return true;
  if (at - talkLock.acquiredAt.toMillis() > MAX_HOLD_MS) return true;
  return false;
}

/**
 * LiveKitのRoom Metadataへ現在の話者情報を書き込む。
 * ルームがまだLiveKit側に存在しない(誰も接続していない)場合は
 * エラーになりうるが、その場合は「competeする相手がいない」ので無視してよい。
 */
async function broadcastCurrentTalker(roomId, uid) {
  try {
    await roomService.updateRoomMetadata(
      roomId,
      JSON.stringify({ currentTalker: uid, updatedAt: nowMs() })
    );
  } catch (e) {
    console.warn(`[talk] メタデータ更新スキップ room=${roomId}: ${e.message}`);
  }
}

/**
 * POST /rooms/:roomId/talk/start
 * ロックが空 / 失効済み / 既に自分自身が保持中 のいずれかであれば取得成功。
 * 他人が有効に保持中なら 409。
 */
router.post('/:roomId/talk/start', requireFirebaseAuth, requireRoomMembership, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId } = req.params;
  const roomRef = db.collection('rooms').doc(roomId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists) {
        throw { httpStatus: 404, message: 'ルームが見つかりません' };
      }
      const room = snap.data();
      const at = nowMs();

      if (room.talkLock && !isStale(room.talkLock, at) && room.talkLock.uid !== uid) {
        throw { httpStatus: 409, message: '他のユーザーが発話中です', code: 'talk_locked' };
      }

      const acquiredAt =
        room.talkLock && room.talkLock.uid === uid && !isStale(room.talkLock, at)
          ? room.talkLock.acquiredAt // 同一ユーザーの再取得(例: 連打)ではacquiredAtを更新しない
          : new Date(at);

      const talkLock = {
        uid,
        acquiredAt,
        expiresAt: new Date(at + LOCK_TTL_MS),
      };
      tx.update(roomRef, { talkLock });
      return talkLock;
    });

    // LiveKit管理APIへのメタデータ更新(broadcastCurrentTalker)は、他クライアントへの
    // 周知が目的の副作用にすぎず、ロックの成否(=Firestoreトランザクションの結果)には
    // 影響しない。実測でこの呼び出しに1〜2秒かかることが分かったため、
    // クライアントへのレスポンスをブロックしないよう意図的にawaitしない。
    broadcastCurrentTalker(roomId, uid);
    console.log(`[talk/start] room=${roomId} uid=${uid}`);
    res.json({ acquired: true, expiresInMs: LOCK_TTL_MS });
  } catch (e) {
    if (e && e.httpStatus) {
      return res.status(e.httpStatus).json({ error: e.message, code: e.code });
    }
    console.error('[talk/startエラー]', e.message);
    res.status(500).json({ error: '発話ロックの取得に失敗しました' });
  }
});

/**
 * POST /rooms/:roomId/talk/heartbeat
 * 保持中のロックのexpiresAtを延長する。MAX_HOLD_MSを超えていたら打ち切り(409)。
 */
router.post('/:roomId/talk/heartbeat', requireFirebaseAuth, requireRoomMembership, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId } = req.params;
  const roomRef = db.collection('rooms').doc(roomId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists) throw { httpStatus: 404, message: 'ルームが見つかりません' };
      const room = snap.data();
      const at = nowMs();

      if (!room.talkLock || room.talkLock.uid !== uid) {
        throw { httpStatus: 409, message: 'ロックを保持していません', code: 'talk_not_held' };
      }
      if (at - room.talkLock.acquiredAt.toMillis() > MAX_HOLD_MS) {
        tx.update(roomRef, { talkLock: null });
        throw { httpStatus: 409, message: '最大発話時間を超えました', code: 'talk_max_hold_exceeded' };
      }

      tx.update(roomRef, {
        talkLock: { ...room.talkLock, expiresAt: new Date(at + LOCK_TTL_MS) },
      });
    });
    res.json({ renewed: true, expiresInMs: LOCK_TTL_MS });
  } catch (e) {
    if (e && e.httpStatus) {
      if (e.code === 'talk_max_hold_exceeded') {
        broadcastCurrentTalker(roomId, null);
      }
      return res.status(e.httpStatus).json({ error: e.message, code: e.code });
    }
    console.error('[talk/heartbeatエラー]', e.message);
    res.status(500).json({ error: '発話ロックの延長に失敗しました' });
  }
});

/**
 * POST /rooms/:roomId/talk/stop
 * 自分が保持しているロックのみ解放できる(他人のロックは触れない)。
 * 冪等: 既に解放済み/失効済みでも成功として扱う。
 */
router.post('/:roomId/talk/stop', requireFirebaseAuth, requireRoomMembership, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId } = req.params;
  const roomRef = db.collection('rooms').doc(roomId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists) throw { httpStatus: 404, message: 'ルームが見つかりません' };
      const room = snap.data();
      if (room.talkLock && room.talkLock.uid === uid) {
        tx.update(roomRef, { talkLock: null });
      }
      // 自分のロックでなければ何もしない(既に他人が取得済み or 元々空)
    });
    // start と同様、レスポンスをブロックしないよう意図的にawaitしない。
    broadcastCurrentTalker(roomId, null);
    console.log(`[talk/stop] room=${roomId} uid=${uid}`);
    res.json({ released: true });
  } catch (e) {
    if (e && e.httpStatus) {
      return res.status(e.httpStatus).json({ error: e.message, code: e.code });
    }
    console.error('[talk/stopエラー]', e.message);
    res.status(500).json({ error: '発話ロックの解放に失敗しました' });
  }
});

module.exports = router;
