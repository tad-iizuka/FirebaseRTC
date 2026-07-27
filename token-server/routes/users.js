/**
 * routes/users.js
 *
 * [2026-07-27 新設] admin-dashboard「ユーザー管理」画面向けのAPI。
 *
 * [経緯] Phase13実装当初(二十訂)、バッジの付与/剥奪はRoom詳細画面
 * (`routes/badges.js`の`POST/DELETE /admin/rooms/:roomId/members/:targetUid/
 * badges*`)から行う設計だった。しかし`badgeGrants`はそもそもroomIdを
 * 持たないユーザー単位のレコードであり(`lib/badges.js`参照)、Room詳細画面
 * から付与するのは「そのRoomの参加者一覧からuidを見つけられた」という
 * 実装上の都合にすぎず、バッジという概念自体とは無関係だった、という
 * ユーザー指摘を受けてこのファイルに一本化した。
 *
 * [Room文脈なしでどうやって対象ユーザーを見つけるか]
 * このアプリには「ユーザー一覧」を返すAPIも「ユーザー×団体の所属関係」
 * (Phase11で明示的に非実装)もこれまで存在しなかった。Firebase Authが
 * 唯一のグローバルなユーザー台帳であるため、Admin SDKの`auth.listUsers`を
 * 直接使う。またこのアプリのMemberはメールアドレス認証必須(5.2)で
 * Guest(匿名認証)はメールアドレスを持たないため、「emailを持つユーザーに
 * 絞り込む」だけで自然にGuestを除外できる(5.3「Guestの対象範囲: 役割
 * バッジのみ、資格・勤続バッジは対象外」とも整合する)。
 *
 * [権限]
 * 一覧・プロフィール閲覧は新設の`users:monitor`。バッジの付与/剥奪自体は
 * 「どの画面から行うか」で必要な権限が変わるのは不自然なため、
 * `routes/badges.js`のRoom詳細画面向け経路が持っていたのと同じ
 * `badges:manage`をそのまま踏襲する(`users:manage`は用意していない。
 * 将来ユーザー無効化等の他の操作を追加する際に、その操作ごとに適切な
 * 権限を検討する)。
 *
 * [将来のユーザー無効化について]
 * Firebase Authの`updateUser(uid, { disabled: true })`で実現できる見込み
 * だが、本改定のスコープ外のため未実装。`users:monitor`権限のレスポンス
 * に含めている`disabled`フィールドは、その拡張のための布石として先に
 * 返却している(5.2「削除の実体: ユーザー無効化」参照)。
 */

const express = require('express');
const { auth } = require('../lib/firebaseAdmin');
const { logAdminAction } = require('../lib/auditLog');
const { requireFirebaseAuth } = require('../middleware/requireAuth');
const { requireAdminPermission } = require('../middleware/requireAdmin');
const { getBadgesForRoomMembers, grantBadge, revokeBadge } = require('../lib/badges');

const router = express.Router();

function handleLibError(res, e, fallbackMessage) {
  if (e.code === 'auth/user-not-found') {
    return res.status(404).json({ error: '指定されたユーザーが見つかりません' });
  }
  const statusCode = e.statusCode || 500;
  if (statusCode === 500) console.error(`[${fallbackMessage}]`, e.message);
  res.status(statusCode).json({ error: e.message || fallbackMessage });
}

function toUserSummary(userRecord) {
  return {
    uid: userRecord.uid,
    email: userRecord.email ?? null,
    // [Guest判定] Room memberドキュメントのroleとは異なり、Firebase Auth
    // ユーザーレコード単体から判定できるグローバルな軸。emailを持たない
    // = 匿名認証(Guest)。
    isGuest: !userRecord.email,
    disabled: userRecord.disabled,
    createdAt: userRecord.metadata.creationTime ?? null,
    lastSignInAt: userRecord.metadata.lastSignInTime ?? null,
  };
}

/**
 * GET /admin/users?email=<検索文字列>&pageToken=<続き>
 *
 * `auth.listUsers`を1ページ(最大1000件)ずつ走査し、emailに検索文字列を
 * 含む(=email自体を持つ、非Guestの)ユーザーだけを返す。
 *
 * [既知の制約] 1回のリクエストでは1ページ分(最大1000件)しか走査しない。
 * 該当ユーザーが後続ページにいる場合は`nextPageToken`を使って追加リクエスト
 * する必要がある(RoomsListView.vueの階層ナビゲーションが抱える「読み込み
 * 済みページ内のみ」の制約と同種。将来ユーザー数が増え問題になった場合、
 * サーバー側での複数ページ横断走査への変更を検討する)。
 */
router.get('/users', requireFirebaseAuth, requireAdminPermission('users:monitor'), async (req, res) => {
  const emailQuery = (req.query.email ?? '').toString().trim().toLowerCase();
  const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

  try {
    const page = await auth.listUsers(1000, pageToken);
    const matched = page.users
      .filter((u) => u.email && (!emailQuery || u.email.toLowerCase().includes(emailQuery)))
      .map(toUserSummary);
    res.json({ users: matched, nextPageToken: page.pageToken ?? null });
  } catch (e) {
    handleLibError(res, e, 'ユーザー一覧の取得に失敗しました');
  }
});

/** GET /admin/users/:uid … プロフィール(現在保持しているバッジ含む)。 */
router.get('/users/:uid', requireFirebaseAuth, requireAdminPermission('users:monitor'), async (req, res) => {
  try {
    const userRecord = await auth.getUser(req.params.uid);
    // Room文脈を持たないため、getBadgesForRoomMembersに単一要素の配列で渡す
    // (role: 'member'固定。Guestはそもそもemailを持たずこの画面に出てこない
    // 前提だが、直接uid指定でアクセスされた場合に備えisGuestで上書きする)。
    const badgesByUid = await getBadgesForRoomMembers([
      { uid: userRecord.uid, role: userRecord.email ? 'member' : 'guest' },
    ]);
    const { badges, topBadge } = badgesByUid[userRecord.uid];
    res.json({ ...toUserSummary(userRecord), badges, topBadge });
  } catch (e) {
    handleLibError(res, e, 'ユーザー情報の取得に失敗しました');
  }
});

/**
 * POST /admin/users/:uid/badges
 * body: { badgeId }
 */
router.post('/users/:uid/badges', requireFirebaseAuth, requireAdminPermission('badges:manage'), async (req, res) => {
  const { uid } = req.params;
  const badgeId = req.body?.badgeId;
  if (typeof badgeId !== 'string' || !badgeId) {
    return res.status(400).json({ error: 'badgeId は必須です' });
  }

  try {
    const userRecord = await auth.getUser(uid);
    const result = await grantBadge({
      actorUid: req.firebaseUser.uid,
      targetUid: uid,
      targetRole: userRecord.email ? 'member' : 'guest',
      badgeId,
    });

    await logAdminAction({
      actorUid: req.firebaseUser.uid,
      action: 'badge.grant',
      targetUid: uid,
      detail: { badgeId, via: 'users' },
    });

    console.log(`[バッジ付与] target=${uid} badgeId=${badgeId} by=${req.firebaseUser.uid} via=users`);
    res.status(201).json(result);
  } catch (e) {
    handleLibError(res, e, 'バッジの付与に失敗しました');
  }
});

/** DELETE /admin/users/:uid/badges/:badgeId */
router.delete(
  '/users/:uid/badges/:badgeId',
  requireFirebaseAuth,
  requireAdminPermission('badges:manage'),
  async (req, res) => {
    const { uid, badgeId } = req.params;
    try {
      const result = await revokeBadge({ actorUid: req.firebaseUser.uid, targetUid: uid, badgeId });

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: 'badge.revoke',
        targetUid: uid,
        detail: { badgeId, via: 'users' },
      });

      console.log(`[バッジ剥奪] target=${uid} badgeId=${badgeId} by=${req.firebaseUser.uid} via=users`);
      res.json(result);
    } catch (e) {
      handleLibError(res, e, 'バッジの剥奪に失敗しました');
    }
  }
);

module.exports = router;
