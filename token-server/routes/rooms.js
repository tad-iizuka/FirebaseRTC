/**
 * ルーム管理API
 *
 * [設計方針]
 * 「ルームIDを知っていれば誰でも入れる」という穴を塞ぐため、
 * ルームは招待制(invite_only)とし、参加には招待コードの検証を必須にする。
 * クライアントからFirestoreへの直接書き込みは一切許可せず(firestore.rules参照)、
 * 必ずこのAPI経由でmembersドキュメントを作成させることで、
 * 招待コード検証をサーバー側で強制する。
 *
 * [Phase8] BAN・role変更等の管理系操作はすべて lib/auditLog.js 経由で
 * auditLogsコレクションへ記録する(誰が・いつ・何をしたかの追跡用)。
 */

const express = require('express');
const crypto = require('crypto');
const { RoomServiceClient } = require('livekit-server-sdk');
const { db } = require('../lib/firebaseAdmin');
const { logAdminAction } = require('../lib/auditLog');
const { requireFirebaseAuth, isValidRoomId } = require('../middleware/requireAuth');

const router = express.Router();

// RoomServiceClientはLiveKitの管理API(https)を叩くためのクライアント。
// クライアント接続に使うwss://のURLとは別に、https://のホストが必要。
const roomService = new RoomServiceClient(
  process.env.LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

const DEFAULT_MAX_MEMBERS = 20;

/**
 * 人が手入力・共有しやすい8文字の招待コードを生成する。
 * 紛らわしい文字(0/O, 1/I/L等)は除外している。
 */
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

/**
 * POST /rooms
 * body: { maxMembers?: number }
 *
 * 呼び出したユーザーがownerになる新規ルームを作成する。
 * 招待コードはこの時点で発行され、レスポンスで返す
 * (ownerが招待したい相手にこのコードを別途共有する想定)。
 */
router.post('/', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const maxMembers = Number.isInteger(req.body?.maxMembers) ? req.body.maxMembers : DEFAULT_MAX_MEMBERS;

  if (maxMembers < 2 || maxMembers > 200) {
    return res.status(400).json({ error: 'maxMembers は 2〜200 の範囲で指定してください' });
  }

  try {
    const roomRef = db.collection('rooms').doc();
    const inviteCode = generateInviteCode();

    await roomRef.set({
      ownerUid: uid,
      createdAt: new Date(),
      visibility: 'invite_only',
      inviteCode,
      maxMembers,
    });

    await roomRef.collection('members').doc(uid).set({
      role: 'owner',
      displayName: req.firebaseUser.name || req.firebaseUser.email || uid,
      status: 'active',
      joinedAt: new Date(),
    });

    console.log(`[ルーム作成] roomId=${roomRef.id} owner=${uid}`);
    res.status(201).json({ roomId: roomRef.id, inviteCode });
  } catch (e) {
    console.error('[ルーム作成エラー]', e.message);
    res.status(500).json({ error: 'ルームの作成に失敗しました' });
  }
});

/**
 * POST /rooms/:roomId/join
 * body: { inviteCode: string }
 *
 * 招待コードを検証し、正しければmembersに自分自身を追加する。
 * 既にBAN済みのメンバーは再参加できない。
 * 既にメンバーの場合は冪等に成功を返す(定員チェックはスキップ)。
 */
router.post('/:roomId/join', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId } = req.params;
  const inviteCode = String(req.body?.inviteCode || '').trim();

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }
  if (!inviteCode) {
    return res.status(400).json({ error: 'inviteCode は必須です' });
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }
    const room = roomSnap.data();
    if (room.inviteCode !== inviteCode) {
      return res.status(403).json({ error: '招待コードが正しくありません' });
    }

    const memberRef = roomRef.collection('members').doc(uid);
    const memberSnap = await memberRef.get();
    if (memberSnap.exists && memberSnap.data().status === 'banned') {
      return res.status(403).json({ error: 'このルームから排除されています' });
    }

    if (!memberSnap.exists) {
      const activeMembers = await roomRef.collection('members').where('status', '==', 'active').get();
      if (activeMembers.size >= room.maxMembers) {
        return res.status(403).json({ error: 'ルームの定員に達しています' });
      }
      await memberRef.set({
        role: 'member',
        displayName: req.firebaseUser.name || req.firebaseUser.email || uid,
        status: 'active',
        joinedAt: new Date(),
      });
      console.log(`[ルーム参加] roomId=${roomId} uid=${uid}`);
    }

    res.json({ roomId, joined: true });
  } catch (e) {
    console.error('[ルーム参加エラー]', e.message);
    res.status(500).json({ error: 'ルームへの参加に失敗しました' });
  }
});

/**
 * POST /rooms/:roomId/members/:targetUid/ban
 *
 * owner/moderatorのみ実行可能。対象ユーザーをbanned化した上で、
 * LiveKit側からも即時キックする。
 *
 * [重要] Firestoreの書き換えだけでは、対象ユーザーが既に持っている
 * LiveKit接続・トークンをその場で無効化できない(トークンの有効期限=10分間は
 * 接続し続けられてしまう)。そのため RoomServiceClient.removeParticipant で
 * 物理的に切断するところまでをワンセットで行う。
 */
router.post('/:roomId/members/:targetUid/ban', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId, targetUid } = req.params;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }
  if (targetUid === uid) {
    return res.status(400).json({ error: '自分自身をBANすることはできません' });
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);

    const actorSnap = await roomRef.collection('members').doc(uid).get();
    if (!actorSnap.exists || !['owner', 'moderator'].includes(actorSnap.data().role)) {
      return res.status(403).json({ error: '権限がありません' });
    }

    const targetRef = roomRef.collection('members').doc(targetUid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      return res.status(404).json({ error: '対象のメンバーが見つかりません' });
    }
    if (targetSnap.data().role === 'owner') {
      return res.status(403).json({ error: 'オーナーをBANすることはできません' });
    }

    await targetRef.update({ status: 'banned', bannedAt: new Date(), bannedBy: uid });

    try {
      await roomService.removeParticipant(roomId, targetUid);
    } catch (e) {
      // 対象が現在ルームに接続していない場合はLiveKit側がエラーを返すが、
      // Firestore側のBAN状態は既に確定しているため致命的ではない。
      console.warn('[LiveKit即時キック失敗(未接続の可能性)]', e.message);
    }

    await logAdminAction({
      actorUid: uid,
      action: 'room:ban',
      targetRoomId: roomId,
      targetUid,
      detail: {},
    });

    console.log(`[BAN] roomId=${roomId} target=${targetUid} by=${uid}`);
    res.json({ roomId, targetUid, banned: true });
  } catch (e) {
    console.error('[BAN処理エラー]', e.message);
    res.status(500).json({ error: 'BAN処理に失敗しました' });
  }
});

/**
 * POST /rooms/:roomId/members/:targetUid/role
 * body: { role: "moderator" | "member" }
 *
 * [Phase8: moderator任命API]
 * [設計方針] 「誰が新しいmoderatorを任命できるか」を単純化するため、
 * 任命権はowner本人のみに一元化する(moderatorが別のmoderatorを任命・降格
 * することはできない)。ownerの role 自体はこのAPIでは変更できない
 * (ownerが誤って自分をmemberに降格し、以後誰も管理操作できなくなる事故を
 * 防ぐため)。README.mdの「未実装・今後の検討事項」に記載のあった
 * 「moderator権限の付与手段が無い」を解消するAPI。
 */
router.post('/:roomId/members/:targetUid/role', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId, targetUid } = req.params;
  const role = req.body?.role;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }
  if (!['moderator', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role は moderator または member を指定してください' });
  }
  if (targetUid === uid) {
    return res.status(400).json({ error: '自分自身のroleを変更することはできません' });
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);

    const actorSnap = await roomRef.collection('members').doc(uid).get();
    if (!actorSnap.exists || actorSnap.data().role !== 'owner') {
      return res.status(403).json({ error: '権限がありません(ownerのみ実行可能)' });
    }

    const targetRef = roomRef.collection('members').doc(targetUid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      return res.status(404).json({ error: '対象のメンバーが見つかりません' });
    }
    const targetData = targetSnap.data();
    if (targetData.role === 'owner') {
      return res.status(403).json({ error: 'オーナーのroleは変更できません' });
    }
    if (targetData.status === 'banned') {
      return res.status(400).json({ error: 'BAN済みのメンバーのroleは変更できません' });
    }

    await targetRef.update({ role });

    await logAdminAction({
      actorUid: uid,
      action: 'room:role_change',
      targetRoomId: roomId,
      targetUid,
      detail: { newRole: role, previousRole: targetData.role },
    });

    console.log(`[role変更] roomId=${roomId} target=${targetUid} role=${role} by=${uid}`);
    res.json({ roomId, targetUid, role });
  } catch (e) {
    console.error('[role変更エラー]', e.message);
    res.status(500).json({ error: 'roleの変更に失敗しました' });
  }
});

module.exports = router;
