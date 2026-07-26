/**
 * routes/badges.js
 *
 * [Phase13] バッジマスタ(badges collection)の管理API、および
 * admin-dashboardからのバッジ付与/剥奪の並行パス。すべて/admin配下に
 * マウントする(routes/organizations.jsと同じ構成)。
 *
 * [権限]
 * バッジマスタの閲覧・作成・編集は organizations.js の
 * organizations:monitor / organizations:manage の使い分けを踏襲し、
 * badges:monitor / badges:manage とする。
 *
 * [なぜ団体スコープが無いのに/admin配下なのか]
 * Phase13時点のbadgesマスタは団体IDを持たないシンプルな1マスタ構成
 * (brushup-plan.md 6.1 item14で確定)だが、運用主体は「システム管理者」
 * であり(5.3「業種プロファイルの初期値はシステム管理者が登録・変更」)、
 * Room内の誰か(owner等)が編集するものではないため、Room内roleの対応表
 * (lib/permissions.js)ではなくサイト管理者権限(middleware/requireAdmin.js)
 * 側に置く。
 *
 * [admin-dashboard経由のgrant/revokeについて]
 * routes/roomBadges.js のRoom内owner専用パスとは別に、admin-dashboardから
 * 直接付与/剥奪できる経路をここに用意する。moderator任命APIが
 * routes/admin.js に同種の並行パスを持つのと同じ理由
 * (「room内のownerが不在・連絡が取れない場合にサイト管理者が代行できる
 * 手段」)。実処理は lib/badges.js の grantBadge/revokeBadge を共有するため、
 * 一意性チェック・監査ログの実装は重複しない。
 */

const express = require('express');
const { db } = require('../lib/firebaseAdmin');
const { logAdminAction } = require('../lib/auditLog');
const { requireFirebaseAuth, isValidRoomId } = require('../middleware/requireAuth');
const { requireAdminPermission } = require('../middleware/requireAdmin');
const {
  listBadges,
  createBadge,
  updateBadge,
  getBadgesForRoomMembers,
  grantBadge,
  revokeBadge,
  getBadgeDisplayConfig,
  setBadgeDisplayConfig,
} = require('../lib/badges');

const router = express.Router();

function handleLibError(res, e, fallbackMessage) {
  const statusCode = e.statusCode || 500;
  if (statusCode === 500) console.error(`[${fallbackMessage}]`, e.message);
  res.status(statusCode).json({ error: e.message || fallbackMessage });
}

/** GET /admin/badges … バッジマスタ一覧(active/非activeを問わず全件)。 */
router.get('/badges', requireFirebaseAuth, requireAdminPermission('badges:monitor'), async (req, res) => {
  try {
    const badges = await listBadges();
    res.json({ badges });
  } catch (e) {
    handleLibError(res, e, 'バッジ一覧の取得に失敗しました');
  }
});

/**
 * POST /admin/badges
 * body: { name, icon, description?, category, grantMethod, autoGrantCondition?, priority, active? }
 */
router.post('/badges', requireFirebaseAuth, requireAdminPermission('badges:manage'), async (req, res) => {
  try {
    const badge = await createBadge({ actorUid: req.firebaseUser.uid, body: req.body || {} });
    await logAdminAction({
      actorUid: req.firebaseUser.uid,
      action: 'badge.master_create',
      detail: { badgeId: badge.badgeId, name: badge.name },
    });
    res.status(201).json(badge);
  } catch (e) {
    handleLibError(res, e, 'バッジの作成に失敗しました');
  }
});

/**
 * PATCH /admin/badges/:badgeId
 * body: 更新したいフィールドのみ(部分更新)
 *
 * [廃止について] deleteエンドポイントは用意しない。active:falseへの更新で
 * 「廃止済み・新規付与不可」を表現する(phase13-badge-schema.md「2.」
 * activeフィールド参照。既存の付与には影響しない)。
 */
router.patch('/badges/:badgeId', requireFirebaseAuth, requireAdminPermission('badges:manage'), async (req, res) => {
  try {
    const badge = await updateBadge({ badgeId: req.params.badgeId, body: req.body || {} });
    await logAdminAction({
      actorUid: req.firebaseUser.uid,
      action: 'badge.master_update',
      detail: { badgeId: badge.badgeId, patch: req.body },
    });
    res.json(badge);
  } catch (e) {
    handleLibError(res, e, 'バッジの更新に失敗しました');
  }
});

/** GET /admin/config/badge-display … プロフィール画面の最大表示件数設定。 */
router.get(
  '/config/badge-display',
  requireFirebaseAuth,
  requireAdminPermission('badges:monitor'),
  async (req, res) => {
    try {
      res.json(await getBadgeDisplayConfig());
    } catch (e) {
      handleLibError(res, e, '表示設定の取得に失敗しました');
    }
  }
);

router.patch(
  '/config/badge-display',
  requireFirebaseAuth,
  requireAdminPermission('badges:manage'),
  async (req, res) => {
    try {
      const config = await setBadgeDisplayConfig({
        actorUid: req.firebaseUser.uid,
        maxDisplayCount: req.body?.maxDisplayCount,
      });
      res.json(config);
    } catch (e) {
      handleLibError(res, e, '表示設定の更新に失敗しました');
    }
  }
);

/**
 * GET /admin/rooms/:roomId/badges
 *
 * admin-dashboardのRoom詳細画面向け。routes/roomBadges.js の
 * GET /:roomId/badges とロジックは同一(lib/badges.jsを共有)だが、
 * 権限判定がRoom内memberではなくbadges:monitorになる点が異なる
 * (routes/admin.js GET /rooms/:roomId と同じ使い分け)。
 */
router.get(
  '/rooms/:roomId/badges',
  requireFirebaseAuth,
  requireAdminPermission('badges:monitor'),
  async (req, res) => {
    const { roomId } = req.params;
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }
    try {
      const membersSnap = await db
        .collection('rooms')
        .doc(roomId)
        .collection('members')
        .where('status', '==', 'active')
        .get();
      const members = membersSnap.docs.map((doc) => ({ uid: doc.id, role: doc.data().role }));
      const badgesByUid = await getBadgesForRoomMembers(members);
      res.json({ roomId, members: badgesByUid });
    } catch (e) {
      handleLibError(res, e, 'バッジ情報の取得に失敗しました');
    }
  }
);

/**
 * POST /admin/rooms/:roomId/members/:targetUid/badges
 * body: { badgeId }
 *
 * [Room内owner専用APIとの整合性] Guest・BAN済みを対象にした場合を拒否する
 * ガードは routes/roomBadges.js 側と同一の理由でこちらにも適用する。
 */
router.post(
  '/rooms/:roomId/members/:targetUid/badges',
  requireFirebaseAuth,
  requireAdminPermission('badges:manage'),
  async (req, res) => {
    const { roomId, targetUid } = req.params;
    const badgeId = req.body?.badgeId;

    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }
    if (typeof badgeId !== 'string' || !badgeId) {
      return res.status(400).json({ error: 'badgeId は必須です' });
    }

    try {
      const targetRef = db.collection('rooms').doc(roomId).collection('members').doc(targetUid);
      const targetSnap = await targetRef.get();
      if (!targetSnap.exists) {
        return res.status(404).json({ error: '対象のメンバーが見つかりません' });
      }
      if (targetSnap.data().status === 'banned') {
        return res.status(400).json({ error: 'BAN済みのメンバーにバッジは付与できません' });
      }

      const result = await grantBadge({
        actorUid: req.firebaseUser.uid,
        targetUid,
        targetRole: targetSnap.data().role,
        badgeId,
      });

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: 'badge.grant',
        targetRoomId: roomId,
        targetUid,
        detail: { badgeId, via: 'admin_dashboard' },
      });

      res.status(201).json(result);
    } catch (e) {
      handleLibError(res, e, 'バッジの付与に失敗しました');
    }
  }
);

router.delete(
  '/rooms/:roomId/members/:targetUid/badges/:badgeId',
  requireFirebaseAuth,
  requireAdminPermission('badges:manage'),
  async (req, res) => {
    const { roomId, targetUid, badgeId } = req.params;
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }
    try {
      const result = await revokeBadge({ actorUid: req.firebaseUser.uid, targetUid, badgeId });

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: 'badge.revoke',
        targetRoomId: roomId,
        targetUid,
        detail: { badgeId, via: 'admin_dashboard' },
      });

      res.json(result);
    } catch (e) {
      handleLibError(res, e, 'バッジの剥奪に失敗しました');
    }
  }
);

module.exports = router;
