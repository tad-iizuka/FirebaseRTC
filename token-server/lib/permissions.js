/**
 * lib/permissions.js
 *
 * [Phase12] Room内role(owner/moderator/member/guest) × 操作 の対応表を
 * 一箇所に集約する。
 *
 * [背景] Phase12着手前の棚卸しで、同じ「owner/moderatorのみ許可」という
 * ホワイトリストが routes/rooms.js・routes/recording.js にそれぞれ個別に
 * ハードコードされていることが判明した(`['owner', 'moderator'].includes(role)`
 * という同一のパターンが複数箇所に重複)。将来role構成が変わった場合
 * (例: 新しいroleの追加、moderatorの権限細分化)に、全箇所を漏れなく
 * 追随させるのが難しくなるため、対応表をこのモジュールに一本化し、
 * 各ルートはここから参照する形に揃える。
 *
 * [対象外] admin-dashboard向けのサイト管理者権限
 * (`adminUsers/{uid}.permissions`、例: rooms:monitor/rooms:manage)は、
 * Room内roleとは全く別の軸(誰がどのRoomのメンバーかに関係なく付与される
 * 権限)であり、middleware/requireAdmin.js 側で完結して管理している。
 * このモジュールでは扱わない(brushup-plan.md Phase12の棚卸しで、
 * 両者は設計思想が異なる別軸として記録済み)。
 *
 * [使い方]
 *   - 操作の可否だけを知りたい: hasRoomPermission(role, operation)
 *   - Express のミドルウェアとして使いたい(requireRoomMembership の後段。
 *     req.roomMember が必要): requireRoomPermission(operation)
 *   - actorのroleをFirestoreから個別に取得している既存コード
 *     (routes/rooms.js の BAN・moderator任命API等、requireRoomMembership
 *     ミドルウェアを経由しない箇所)は hasRoomPermission を直接呼ぶ。
 */

const ROOM_ROLES = ['owner', 'moderator', 'member', 'guest'];

/**
 * 操作ごとに許可されるroleの配列。
 *
 * 配列に `ROOM_ROLES`(4種すべて)を指定している操作は「role不問、
 * room memberでありさえすれば誰でも可能」という意味であり、実質的には
 * `requireRoomMembership` ミドルウェアのみで担保されている操作である。
 * 一見冗長だが、"この操作は意図的にrole不問である"ことを対応表上で
 * 明示するために書いている(書き漏れなのか意図なのかを後から見て
 * 判別できるようにするため)。
 */
const ROOM_OPERATIONS = {
  // routes/rooms.js
  'members:ban': ['owner', 'moderator'],
  // moderator任命/降格。「誰が新しいmoderatorを任命できるか」を単純化する
  // ため owner のみに一元化している(rooms.js冒頭コメント参照)。
  'members:assign_role': ['owner'],
  'room:settings_update': ['owner', 'moderator'], // 自動録音トグル(Room内role経由)
  'nickname:update': ROOM_ROLES, // 本人のみ実行可能という制約は別途ルート側でチェック
  'org_context:read': ROOM_ROLES,

  // routes/talk.js
  'talk:control': ROOM_ROLES,

  // routes/messages.js
  'chat:send': ROOM_ROLES,
  // [Phase16] チャット添付ファイル。5.1/7.3で確定した通りGuestも送受信可能
  // なため、テキスト送信(chat:send)と同じくrole不問とする。
  'chat:attachment_upload': ROOM_ROLES,
  'chat:attachment_read': ROOM_ROLES,

  // routes/recording.js
  'recording:start': ['owner', 'moderator'],
  'recording:stop': ['owner', 'moderator'],
  'recording:status:read': ROOM_ROLES,
  'recording:history:read': ROOM_ROLES, // 「全参加者への開示」方針(recording.js参照)
  'recording:download_url': ['owner', 'moderator'],
  'recording:delete': ['owner', 'moderator'],

  // routes/roomBadges.js [Phase13]
  // 5.3「付与経路: Owner手動」の通り、moderatorには広げずownerのみに限定する
  // (members:assign_roleと同じ考え方。badges:grant/revokeはRoom内で完結する
  // Owner専用APIのためのエントリであり、admin-dashboard側の badges:manage
  // (サイト管理者権限)とは別軸)。
  'badges:grant': ['owner'],
  'badges:revoke': ['owner'],
  'badges:read': ROOM_ROLES,
};

/**
 * 指定したroleがoperationを実行できるかどうかを返す。
 * operationがROOM_OPERATIONSに未定義の場合は例外を投げる
 * (「対応表に無い操作を無許可のまま通してしまう」事故を防ぐため、
 * 黙ってfalseを返さずフェイルファストする)。
 */
function hasRoomPermission(role, operation) {
  const allowedRoles = ROOM_OPERATIONS[operation];
  if (!allowedRoles) {
    throw new Error(`[lib/permissions] 対応表に未定義の操作です: ${operation}`);
  }
  return allowedRoles.includes(role);
}

/**
 * requireRoomMembership の後段で使う前提のExpressミドルウェア。
 * req.roomMember.role を見て、operationを実行できなければ403を返す。
 */
function requireRoomPermission(operation) {
  return function (req, res, next) {
    if (!hasRoomPermission(req.roomMember.role, operation)) {
      return res.status(403).json({ error: '権限がありません' });
    }
    next();
  };
}

/**
 * [Phase12] moderator任命/降格の「対象role」ガード。
 *
 * routes/rooms.js の `POST /:roomId/members/:targetUid/role`(Room内owner専用)と
 * routes/admin.js の `PATCH /admin/rooms/:roomId/members/:targetUid/role`
 * (サイト管理者による代行、rooms:manage権限)の2箇所で、
 * 「owner降格禁止・BAN済み対象禁止・guest任命禁止」という全く同じチェックが
 * 重複実装されていた(phase12-role-operation-inventory.md 論点4)ため、
 * ここに集約する。
 *
 * ここで見るのは「誰が呼んでいるか」ではなく「対象(targetData)に対して
 * このrole変更を行ってよいか」のみ。呼び出し側の権限確認(owner本人か、
 * rooms:manage権限を持つ管理者か)は、この関数を呼ぶ側の責務のまま分離している
 * (Room内roleとサイト管理者権限は別軸のため、ここで一緒くたにしない)。
 *
 * @param {{role?: string, status?: string} | null | undefined} targetData
 *   対象メンバーのFirestoreドキュメントデータ(存在しない場合はnull/undefined)
 * @returns {{status: number, error: string} | null}
 *   許可されない場合は{status, error}。許可される場合はnull。
 */
function checkRoleAssignmentTarget(targetData) {
  if (!targetData) {
    return { status: 404, error: '対象のメンバーが見つかりません' };
  }
  if (targetData.role === 'owner') {
    return { status: 403, error: 'オーナーのroleは変更できません' };
  }
  if (targetData.status === 'banned') {
    return { status: 400, error: 'BAN済みのメンバーのroleは変更できません' };
  }
  // Guestは本人確認のない匿名認証由来のため、moderatorへ任命できてしまう
  // 抜け道を塞ぐ。Member昇格の導線自体を設けない方針(5.1参照)とも整合させる。
  if (targetData.role === 'guest') {
    return { status: 403, error: 'Guestのroleは変更できません' };
  }
  return null;
}

module.exports = {
  ROOM_ROLES,
  ROOM_OPERATIONS,
  hasRoomPermission,
  requireRoomPermission,
  checkRoleAssignmentTarget,
};
