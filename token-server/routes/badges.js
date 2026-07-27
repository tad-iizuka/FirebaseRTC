/**
 * routes/badges.js
 *
 * [Phase13] バッジマスタ(badges collection)の管理API、および
 * admin-dashboard向けのRoomメンバーのバッジ閲覧(読み取り専用)。
 * すべて/admin配下にマウントする(routes/organizations.jsと同じ構成)。
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
 * [admin-dashboard経由のgrant/revokeについて(2026-07-27 移設)]
 * 以前はここにRoom内メンバーへのバッジ付与/剥奪(`POST/DELETE
 * /admin/rooms/:roomId/members/:targetUid/badges*`)も実装していたが、
 * バッジ自体がRoomに紐付かないユーザー単位の概念である以上、Room詳細画面
 * から付与するのは不自然というユーザー指摘を受け、`routes/users.js`の
 * `POST/DELETE /admin/users/:uid/badges*`に一本化した。このファイルには
 * 「このRoomの現在のメンバーが何のバッジを持っているか」を見るための
 * 読み取り専用API(下記GET)のみを残す。
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

module.exports = router;
