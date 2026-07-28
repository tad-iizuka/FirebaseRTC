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
const { resolveOrgContext } = require('../lib/orgContext');
const { requireFirebaseAuth, isValidRoomId, requireRoomMembership } = require('../middleware/requireAuth');
const { hasRoomPermission, requireRoomPermission, checkRoleAssignmentTarget } = require('../lib/permissions');

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
 *
 * [Phase12] Guest(匿名認証)によるRoom作成を拒否する。
 * このRoomではまだmembersドキュメントが存在しないため、/joinの
 * role自動判定と同じ基準(firebase.sign_in_provider)をここでも直接見る。
 * 従来はクライアント側のUI非表示のみで防いでいたが(3クライアントとも
 * `auth.currentUser?.isAnonymous`相当を見て「ルームを作成」ボタンを隠す
 * だけだった)、API直叩きや改造クライアントからは素通りしてしまう状態
 * だったため、サーバー側でも明示的に強制する。
 * 「本人確認のできないownerが永続的に残ってしまう」というGuestの
 * 一時参加という設計思想と矛盾する事態を防ぐのが目的(Guestロール5.1参照)。
 */
router.post('/', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;

  if (req.firebaseUser.firebase?.sign_in_provider === 'anonymous') {
    return res.status(403).json({ error: 'ゲストはルームを作成できません' });
  }

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
      // [Phase9] ルームがアクティブになった瞬間(room_startedイベント)に
      // 自動で録音を開始するかどうか。デフォルトはfalse(従来通り手動開始)。
      // routes/webhooks.js の handleRoomStarted / PATCH /:roomId/settings 参照。
      settings: { autoRecording: false },
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

      // [Phase10: Guestロール]
      // 「Firebase匿名認証で入ってきたかどうか」はIDトークンの検証結果
      // (firebase.sign_in_provider)であり、クライアントが自己申告できる値
      // ではない。これを正としてrole判定を行うことで、
      // 「本当は匿名認証なのにroleだけmemberと偽装する」余地を無くしている。
      // 参加後にMemberへ昇格する導線は設けない(5.1参照)。GuestのIDは
      // 生成されたまま保持し、Member系の識別子体系とは一切紐付けない。
      const isGuest = req.firebaseUser.firebase?.sign_in_provider === 'anonymous';

      await memberRef.set({
        role: isGuest ? 'guest' : 'member',
        // 匿名認証ではname/emailを持たないため、5.1の「表示名ルール」通り
        // 未設定ならID(uid)がそのまま表示名になる。ニックネームは別途
        // PATCH /:roomId/nickname で本人が設定する。
        displayName: req.firebaseUser.name || req.firebaseUser.email || uid,
        status: 'active',
        joinedAt: new Date(),
      });
      console.log(`[ルーム参加] roomId=${roomId} uid=${uid} role=${isGuest ? 'guest' : 'member'}`);
    }

    // [同意/開示] 自動録音が有効なルームであることを、実際に接続する前の
    // このレスポンス時点でクライアントに伝える。録音中であることをRoom
    // Metadata経由で開示する既存方針(recording.js冒頭コメント参照)を、
    // 「まだ誰も録音開始ボタンを押していないのに録音が始まる」自動録音の
    // ケースでも入室前から満たすため。
    const finalMemberSnap = memberSnap.exists ? memberSnap : await memberRef.get();
    res.json({
      roomId,
      joined: true,
      role: finalMemberSnap.data().role,
      autoRecording: !!room.settings?.autoRecording,
    });
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
    if (!actorSnap.exists || !hasRoomPermission(actorSnap.data().role, 'members:ban')) {
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
    if (!actorSnap.exists || !hasRoomPermission(actorSnap.data().role, 'members:assign_role')) {
      return res.status(403).json({ error: '権限がありません(ownerのみ実行可能)' });
    }

    const targetRef = roomRef.collection('members').doc(targetUid);
    const targetSnap = await targetRef.get();
    // [Phase12] owner降格禁止・BAN済み対象禁止・guest任命禁止のガードは
    // routes/admin.js の代行API(サイト管理者経由)と共通のため
    // lib/permissions.js の checkRoleAssignmentTarget に集約した。
    const targetGuardError = checkRoleAssignmentTarget(targetSnap.exists ? targetSnap.data() : null);
    if (targetGuardError) {
      return res.status(targetGuardError.status).json({ error: targetGuardError.error });
    }
    const targetData = targetSnap.data();

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

/**
 * PATCH /rooms/:roomId/settings
 * body: { autoRecording: boolean }
 *
 * [Phase9で追加] owner/moderatorのみ。ルームがアクティブになるたび
 * (room_startedイベント。誰かが最初に入室した瞬間)に録音を自動開始するか
 * どうかを切り替える(routes/webhooks.js の handleRoomStarted 参照)。
 *
 * [注意] falseにしても、その時点で既に進行中の録音は止まらない。
 * 「次回以降ルームがアクティブになったときに自動開始しない」という
 * 意味に留め、設定変更が録音状態に直接副作用を持たないようにしている
 * (録音を止めたい場合は既存の POST /:roomId/recording/stop を使う)。
 */
router.patch('/:roomId/settings', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId } = req.params;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }
  if (typeof req.body?.autoRecording !== 'boolean') {
    return res.status(400).json({ error: 'autoRecording はboolean型で指定してください' });
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);

    const actorSnap = await roomRef.collection('members').doc(uid).get();
    if (!actorSnap.exists || !hasRoomPermission(actorSnap.data().role, 'room:settings_update')) {
      return res.status(403).json({ error: '権限がありません' });
    }

    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }

    await roomRef.update({ 'settings.autoRecording': req.body.autoRecording });

    await logAdminAction({
      actorUid: uid,
      action: 'room:settings_update',
      targetRoomId: roomId,
      detail: { autoRecording: req.body.autoRecording },
    });

    console.log(`[設定更新] roomId=${roomId} autoRecording=${req.body.autoRecording} by=${uid}`);
    res.json({ roomId, autoRecording: req.body.autoRecording });
  } catch (e) {
    console.error('[設定更新エラー]', e.message);
    res.status(500).json({ error: '設定の更新に失敗しました' });
  }
});

const MAX_NICKNAME_LENGTH = 30;

/**
 * PATCH /rooms/:roomId/nickname
 * body: { displayName: string }
 *
 * [Phase10: Guestロール 5.1]
 * 自分自身の表示名(ニックネーム)を変更する。roleを問わず本人のみ実行可能
 * (owner/moderator/member/guestいずれも対象。5.1はGuestの文脈で定義した
 * 仕様だが、他roleにも一貫して適用してよい性質のものなので分けていない)。
 *
 * 監査ログには残さない(5.1「変更履歴自体は追わなくてよい」)。
 * 監査ログ・録音の話者記録は内部UID(identity)に追従する設計であり、
 * displayNameの変更はそれらに影響しない(routes/token.jsでLiveKitの
 * identityには常にuidを使っているため)。
 *
 * リアルタイム反映は既存のFirestoreクライアントリスナー(BAN即時反映等と
 * 同じ仕組み)に乗るため、このAPI側で追加の通知処理は行わない。
 *
 * [Phase12] `requireRoomPermission('nickname:update')`を追加。
 * ROOM_OPERATIONSでは元々role不問と定義済みだったが、実装は
 * `requireRoomMembership`止まりだったため揃えた(挙動は変わらない)。
 */
router.patch(
  '/:roomId/nickname',
  requireFirebaseAuth,
  requireRoomMembership,
  requireRoomPermission('nickname:update'),
  async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId } = req.params;
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';

  if (!displayName) {
    return res.status(400).json({ error: 'displayName は必須です' });
  }
  if (displayName.length > MAX_NICKNAME_LENGTH) {
    return res.status(400).json({ error: `displayName は${MAX_NICKNAME_LENGTH}文字以内で指定してください` });
  }

  try {
    await db.doc(`rooms/${roomId}/members/${uid}`).update({ displayName });
    console.log(`[ニックネーム変更] roomId=${roomId} uid=${uid}`);
    res.json({ roomId, displayName });
  } catch (e) {
    console.error('[ニックネーム変更エラー]', e.message);
    res.status(500).json({ error: 'ニックネームの変更に失敗しました' });
  }
});

/**
 * GET /:roomId/org-context
 *
 * [Phase11] このRoomが組織階層(organizations/nodes)のどこに所属するかを
 * 返す。クライアント(Web/iOS/Android)がパンくず表示等に使う想定。
 *
 * organizations/nodesはfirestore.rulesでクライアントへの直接読み取りを
 * 全面拒否しているため、この参照APIが唯一の取得経路になる。
 *
 * 無所属Roomはエラーではなく正式な状態として扱う(5.4参照)。
 * その場合は404ではなく200 + null群を返す。
 *
 * [Phase12] `requireRoomPermission('org_context:read')`を追加。
 * ROOM_OPERATIONSでは元々role不問と定義済みだったが、実装は
 * `requireRoomMembership`止まりだったため揃えた(挙動は変わらない)。
 */
router.get(
  '/:roomId/org-context',
  requireFirebaseAuth,
  requireRoomMembership,
  requireRoomPermission('org_context:read'),
  async (req, res) => {
  const { roomId } = req.params;

  try {
    const roomSnap = await db.collection('rooms').doc(roomId).get();
    const context = await resolveOrgContext(roomSnap.data());
    res.json(context);
  } catch (e) {
    console.error('[org-context取得エラー]', e.message);
    res.status(500).json({ error: '組織階層情報の取得に失敗しました' });
  }
});

module.exports = router;
