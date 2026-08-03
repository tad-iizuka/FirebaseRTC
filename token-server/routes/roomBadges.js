/**
 * routes/roomBadges.js
 *
 * [Phase13] Room内で完結するバッジAPI。
 *   - GET /:roomId/badges                              … 参加者一覧向け(全メンバーのbadges/topBadge)
 *   - POST /:roomId/members/:targetUid/badges           … 手動付与(owner限定)
 *   - DELETE /:roomId/members/:targetUid/badges/:badgeId … 手動剥奪(owner限定)
 *
 * routes/rooms.js から分離しているのは、talk.js/messages.js/recording.js と
 * 同様に「関心ごとに/rooms配下のファイルを分ける」既存の方針を踏襲するため。
 *
 * バッジマスタ自体(badges collectionの作成・編集)は、団体スコープを
 * 持たない全体共通マスタであり運用主体が「システム管理者」であるため、
 * こちらはrouteをroutes/badges.js([Phase13] /admin配下)に分けている。
 * 一方、grant/revokeは「Room内のOwnerが自室のメンバーに対して行う操作」
 * という性質上、Room内roleの対応表(lib/permissions.js)に乗せてこちらに
 * 置く方が既存のBAN・moderator任命APIと一貫する。
 *
 * [admin-dashboard経由の並行パス]
 * routes/rooms.js のmoderator任命が「Room内owner専用API」と「admin-dashboard
 * のrooms:manage権限経由」の2経路を持つのに倣い(RoomDetailView.vueコメント
 * 参照)、バッジのgrant/revokeも admin-dashboard 向けの並行パス
 * (badges:manage権限)を用意している。
 * [2026-07-27] admin-dashboard側の並行パスは、その後 routes/badges.js から
 * routes/users.js(ユーザー管理画面)へ移設された(badgeGrantsがRoomに
 * 紐付かないユーザー単位のレコードであるため)。呼び出し先はいずれも同じ
 * lib/badges.js の grantBadge/revokeBadge のため、実装(一意性チェック・
 * 監査ログ)は重複しない。
 *
 * [2026-08-04] Room内owner専用パス(このファイル)は、バッジマスタ側の
 * `grantableByRoomOwner`フラグがtrueのバッジのみ操作できるよう制限した
 * (grantBadge/revokeBadgeに`viaRoomOwner: true`を渡す)。「当日のリーダー
 * アサイン」のような軽いバッジのみRoom ownerに委譲し、資格章・階級章の
 * ような重いバッジはこれまで通りサイト管理者専用(routes/users.js経由、
 * badges:manage権限)のままにする運用を想定している。フラグはバッジ単位の
 * 単純なON/OFFのみで、role単位(例: moderatorにも一部委譲)の段階分けは
 * 導入していない(ユーザー確認済み)。admin-dashboard経由(routes/users.js)
 * はこの制約を受けない(viaRoomOwnerを渡さないため常にfalse扱い)。
 */

const express = require('express');
const { db } = require('../lib/firebaseAdmin');
const { logAdminAction } = require('../lib/auditLog');
const { requireFirebaseAuth, isValidRoomId, requireRoomMembership } = require('../middleware/requireAuth');
const { hasRoomPermission } = require('../lib/permissions');
const { getBadgesForRoomMembers, grantBadge, revokeBadge, listRoomOwnerGrantableBadges } = require('../lib/badges');

const router = express.Router();

/**
 * GET /:roomId/badges
 *
 * ルームの「アクティブな」メンバー全員について、現在のbadges/topBadgeを
 * 返す。参加者一覧のアイコン表示(最優先1件のみ)・将来のプロフィール画面
 * (全件)のどちらにも使えるよう、topBadgeとbadges(全件、優先度降順)の
 * 両方を含めている。
 *
 * badgeGrantsはfirestore.rulesでクライアントへの直接読み取りを禁止して
 * いるため、この参照APIが唯一の取得経路になる(organizations/nodesと同じ
 * 設計)。
 */
router.get('/:roomId/badges', requireFirebaseAuth, requireRoomMembership, async (req, res) => {
  const { roomId } = req.params;

  try {
    const membersSnap = await db.collection('rooms').doc(roomId).collection('members').where('status', '==', 'active').get();
    const members = membersSnap.docs.map((doc) => ({ uid: doc.id, role: doc.data().role }));

    const badgesByUid = await getBadgesForRoomMembers(members);

    // [2026-08-04] 付与UIの選択肢は、Room内owner(実際にgrant/revokeを
    // 呼べる立場)にのみ返す。「どんなバッジが存在するか」自体は
    // badges:monitor権限が無いRoomメンバーへ広く見せる情報ではないため、
    // ownerでない場合はnullのまま(=UIを出さない)にする。
    const grantableBadges = req.roomMember.role === 'owner' ? await listRoomOwnerGrantableBadges() : null;

    res.json({ roomId, members: badgesByUid, grantableBadges });
  } catch (e) {
    console.error('[Room内バッジ取得エラー]', e.message);
    res.status(500).json({ error: 'バッジ情報の取得に失敗しました' });
  }
});

/**
 * POST /:roomId/members/:targetUid/badges
 * body: { badgeId: string }
 *
 * owner限定。対象がRoomのメンバーであることをrequireRoomMembership相当の
 * チェックで確認した上で付与する(BAN APIと同じくtargetがメンバーである
 * ことの確認は明示的に行う)。
 */
router.post('/:roomId/members/:targetUid/badges', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId, targetUid } = req.params;
  const badgeId = req.body?.badgeId;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }
  if (typeof badgeId !== 'string' || !badgeId) {
    return res.status(400).json({ error: 'badgeId は必須です' });
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);

    const actorSnap = await roomRef.collection('members').doc(uid).get();
    if (!actorSnap.exists || !hasRoomPermission(actorSnap.data().role, 'badges:grant')) {
      return res.status(403).json({ error: '権限がありません(ownerのみ実行可能)' });
    }

    const targetSnap = await roomRef.collection('members').doc(targetUid).get();
    if (!targetSnap.exists) {
      return res.status(404).json({ error: '対象のメンバーが見つかりません' });
    }
    if (targetSnap.data().status === 'banned') {
      return res.status(400).json({ error: 'BAN済みのメンバーにバッジは付与できません' });
    }

    const result = await grantBadge({
      actorUid: uid,
      targetUid,
      targetRole: targetSnap.data().role,
      badgeId,
      // [2026-08-04] Room内owner専用パスであることを明示し、バッジ単位の
      // grantableByRoomOwnerフラグによる絞り込みを受けさせる。
      viaRoomOwner: true,
    });

    await logAdminAction({
      actorUid: uid,
      action: 'badge.grant',
      targetRoomId: roomId,
      targetUid,
      detail: { badgeId },
    });

    console.log(`[バッジ付与] roomId=${roomId} target=${targetUid} badgeId=${badgeId} by=${uid}`);
    res.status(201).json(result);
  } catch (e) {
    const statusCode = e.statusCode || 500;
    if (statusCode === 500) console.error('[バッジ付与エラー]', e.message);
    res.status(statusCode).json({ error: e.message || 'バッジの付与に失敗しました' });
  }
});

/**
 * DELETE /:roomId/members/:targetUid/badges/:badgeId
 *
 * owner限定。
 */
router.delete('/:roomId/members/:targetUid/badges/:badgeId', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { roomId, targetUid, badgeId } = req.params;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);

    const actorSnap = await roomRef.collection('members').doc(uid).get();
    if (!actorSnap.exists || !hasRoomPermission(actorSnap.data().role, 'badges:revoke')) {
      return res.status(403).json({ error: '権限がありません(ownerのみ実行可能)' });
    }

    const result = await revokeBadge({ actorUid: uid, targetUid, badgeId, viaRoomOwner: true });

    await logAdminAction({
      actorUid: uid,
      action: 'badge.revoke',
      targetRoomId: roomId,
      targetUid,
      detail: { badgeId },
    });

    console.log(`[バッジ剥奪] roomId=${roomId} target=${targetUid} badgeId=${badgeId} by=${uid}`);
    res.json(result);
  } catch (e) {
    const statusCode = e.statusCode || 500;
    if (statusCode === 500) console.error('[バッジ剥奪エラー]', e.message);
    res.status(statusCode).json({ error: e.message || 'バッジの剥奪に失敗しました' });
  }
});

module.exports = router;
