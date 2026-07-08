/**
 * 管理者向け: 複数ルーム横断監視API (Phase 5)
 *
 * [設計方針]
 * 「ルームの状態」には2種類の情報源があり、性質が異なる:
 *   1. Firestore (rooms/{roomId}, members) … 誰がメンバーか・BAN状態・
 *      発話ロック・録音状態など「永続化された台帳」
 *   2. LiveKit (RoomServiceClient) … 実際に今、誰が物理的に接続しているか
 *      という「ライブな実態」
 * 例えば「メンバーではあるが今は繋いでいない人」「BANされたが接続自体は
 * 即時キックでもう切れている人」等、両者は一致しない。管理者が見たいのは
 * 主にライブな実態(今何人繋いでいるか)なので、両方を突き合わせて返す。
 *
 * [パフォーマンス上の注意]
 * ルーム一覧APIでは LiveKit の listRooms() を「1回だけ」呼び、
 * ルームごとに listRooms を叩くN+1を避けている。
 * 一方、Firestore側のアクティブメンバー数は count() 集計クエリを
 * ルームごとに呼んでいるため、ページサイズ(最大 MAX_PAGE_SIZE)で
 * 読み取りコストの上限を切っている。
 */

const express = require('express');
const { RoomServiceClient } = require('livekit-server-sdk');
const { db } = require('../lib/firebaseAdmin');
const { requireFirebaseAuth, isValidRoomId } = require('../middleware/requireAuth');
const { requireAdminPermission } = require('../middleware/requireAdmin');

const router = express.Router();

const roomService = new RoomServiceClient(
  process.env.LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * GET /admin/rooms?limit=50&cursor=<roomId>
 *
 * 全ルームを作成日時降順で一覧表示する。ページングはcursor(直前ページ
 * 最後のroomId)方式。
 */
router.get('/rooms', requireFirebaseAuth, requireAdminPermission('rooms:monitor'), async (req, res) => {
  const pageSize = Math.min(
    Number.parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

  try {
    let query = db.collection('rooms').orderBy('createdAt', 'desc').limit(pageSize);
    if (cursor) {
      const cursorSnap = await db.collection('rooms').doc(cursor).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }
    const snap = await query.get();

    // LiveKit側の「今まさに誰か接続しているルーム」一覧を1回だけ取得し、
    // roomId(=LiveKitのroom name)でつき合わせる。
    let liveRoomsByName = new Map();
    try {
      const liveRooms = await roomService.listRooms();
      liveRoomsByName = new Map(liveRooms.map((r) => [r.name, r]));
    } catch (e) {
      console.warn('[管理者ダッシュボード] LiveKit listRooms失敗(Firestore情報のみで応答継続):', e.message);
    }

    const now = Date.now();

    const rooms = await Promise.all(
      snap.docs.map(async (doc) => {
        const room = doc.data();
        const roomId = doc.id;

        let activeMemberCount = null;
        try {
          const countSnap = await db
            .collection('rooms')
            .doc(roomId)
            .collection('members')
            .where('status', '==', 'active')
            .count()
            .get();
          activeMemberCount = countSnap.data().count;
        } catch (e) {
          console.warn(`[管理者ダッシュボード] memberCount取得失敗 room=${roomId}: ${e.message}`);
        }

        const live = liveRoomsByName.get(roomId);

        return {
          roomId,
          ownerUid: room.ownerUid,
          createdAt: room.createdAt?.toMillis?.() ?? null,
          maxMembers: room.maxMembers ?? null,
          activeMemberCount,
          talkLock:
            room.talkLock && room.talkLock.expiresAt.toMillis() > now
              ? { uid: room.talkLock.uid, expiresAt: room.talkLock.expiresAt.toMillis() }
              : null,
          recording:
            room.recording && room.recording.active
              ? { active: true, startedAt: room.recording.startedAt?.toMillis?.() ?? null }
              : { active: false },
          live: {
            isLive: !!live,
            numParticipants: live ? Number(live.numParticipants) : 0,
          },
        };
      })
    );

    res.json({
      rooms,
      nextCursor: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null,
    });
  } catch (e) {
    console.error('[管理者ダッシュボード: ルーム一覧エラー]', e.message);
    res.status(500).json({ error: 'ルーム一覧の取得に失敗しました' });
  }
});

/**
 * GET /admin/rooms/:roomId
 *
 * 1ルームの詳細: メンバー台帳(Firestore) + 実際の接続状況(LiveKit)。
 */
router.get('/rooms/:roomId', requireFirebaseAuth, requireAdminPermission('rooms:monitor'), async (req, res) => {
  const { roomId } = req.params;
  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }
    const room = roomSnap.data();

    const membersSnap = await roomRef.collection('members').get();
    const members = membersSnap.docs.map((d) => {
      const m = d.data();
      return {
        uid: d.id,
        role: m.role,
        displayName: m.displayName,
        status: m.status,
        joinedAt: m.joinedAt?.toMillis?.() ?? null,
        bannedAt: m.bannedAt?.toMillis?.() ?? null,
      };
    });

    // ルームに現在誰も接続していない場合、LiveKit側はNotFoundを返しうる。
    // これは異常ではない(単に「今は誰もいない」)ので、空配列にフォールバックする。
    let liveParticipants = [];
    try {
      const participants = await roomService.listParticipants(roomId);
      liveParticipants = participants.map((p) => ({
        identity: p.identity,
        joinedAt: p.joinedAt ? Number(p.joinedAt) * 1000 : null,
        isPublishingAudio: (p.tracks || []).some((t) => t.type === 'AUDIO' && !t.muted),
      }));
    } catch (e) {
      console.warn(`[管理者ダッシュボード] listParticipants失敗(未接続の可能性) room=${roomId}: ${e.message}`);
    }

    const now = Date.now();
    res.json({
      roomId,
      ownerUid: room.ownerUid,
      createdAt: room.createdAt?.toMillis?.() ?? null,
      maxMembers: room.maxMembers ?? null,
      members,
      talkLock:
        room.talkLock && room.talkLock.expiresAt.toMillis() > now
          ? {
              uid: room.talkLock.uid,
              acquiredAt: room.talkLock.acquiredAt?.toMillis?.() ?? null,
              expiresAt: room.talkLock.expiresAt.toMillis(),
            }
          : null,
      recording:
        room.recording && room.recording.active
          ? {
              active: true,
              startedAt: room.recording.startedAt?.toMillis?.() ?? null,
              startedByUid: room.recording.startedByUid ?? null,
            }
          : { active: false },
      liveParticipants,
    });
  } catch (e) {
    console.error('[管理者ダッシュボード: ルーム詳細エラー]', e.message);
    res.status(500).json({ error: 'ルーム詳細の取得に失敗しました' });
  }
});

module.exports = router;
