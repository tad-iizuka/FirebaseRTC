/**
 * lib/orgRoster.js
 *
 * [組織ロースター層、実装着手 2026-08-01]
 * `phase11-org-roster-design.md`(案C)・`brushup-plan.md` 二十四訂で合意した
 * 「団体管理者(特定orgId配下のみ管理)」スコープの権限判定を1箇所に集約する。
 * routes/organizations.js の各エンドポイント(名簿の閲覧/付与/編集/剥奪)は
 * すべてこのモジュールの resolveRosterAccess() 経由で許可判定する。
 *
 * [階層構造]
 * 固定された名前付きの層(Company admin/Branch group等)を列挙するのではなく、
 * 「あるuidが、あるnodeIdをscopeとして持つ」という1種類の関係を木の任意の
 * 深さに対して適用する、当初合意した再帰的スコープモデルをそのまま採用する。
 *
 *   root                … adminUsers/{uid}.permissions に
 *                          'organizations:manage' を含む(既存の
 *                          サイト全体権限モデルへの素直な参照。rooms:monitor
 *                          等、他のサイト全体権限とは無関係)
 *     └─ org内admin      … organizations/{orgId}/members/{uid},
 *                          orgRole: 'admin'。scopeNodeIds未指定/空 = 団体
 *                          全体を管理。scopeNodeIds: [nodeId, ...] = 指定
 *                          node(木の任意の深さ)とその配下を管理
 *          └─ staff       … orgRole: 'staff'。管理権限を持たない末端
 *
 * [祖先判定] Phase11の routes/organizations.js が node作成時に計算・保存
 * している ancestorIds(非正規化された祖先ID配列)をそのまま流用する。
 * 新規に「parentNodeIdを逐次辿るループ」を実装する必要はない。
 *
 * [override規約] rootは常時org内admin(scope問わず)をoverride可能。
 * org内adminどうしは、ancestorIdsの包含関係により、広いscope(浅いnode、
 * または未指定=団体全体)を持つadminが、狭いscope(その配下のnode)を持つ
 * adminをoverride可能(固定の層数ではなく、scopeの包含関係のみで決まる)。
 *
 * [最初の団体管理者の代理登録(鶏卵問題)について]
 * 別途の代理登録専用APIは用意しない。resolveRosterAccess() は
 * 「root(organizations:manage) OR 対象orgの既存admin」という判定式のため、
 * まだ誰も管理者登録されていない団体に対しても、rootであれば
 * `POST /admin/organizations/:orgId/members/:uid` をそのまま呼べる
 * (routes/organizations.js 側の分岐は不要)。
 */

const { db } = require('./firebaseAdmin');

/**
 * 実行者(uid)がサイト全体の組織管理権限(root)を持つかどうか。
 * 'organizations:manage' のみを見る('organizations:monitor'や
 * 'rooms:monitor'等、他のサイト全体権限はrootとして扱わない)。
 */
async function isSiteWideOrgManager(uid) {
  const snap = await db.collection('adminUsers').doc(uid).get();
  const permissions = snap.exists ? snap.data().permissions || [] : [];
  return permissions.includes('organizations:manage');
}

async function getOrgMember(orgId, uid) {
  const snap = await db.collection('organizations').doc(orgId).collection('members').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * actorのscopeNodeIds(空配列=団体全体)が、targetScopeNodeIdsをすべて
 * カバーしているかどうかを判定する。
 *
 * - actorが団体全体admin(scopeNodeIds未指定/空)なら常にカバーする
 * - targetScopeNodeIdsが空(団体全体)を指す場合、actorが団体全体でない
 *   限りカバーできない(狭いscopeのadminが団体全体scopeを付与/編集する
 *   ことはできない、というoverride規約の裏返し)
 * - それ以外は、targetの各nodeについて、そのnodeの ancestorIds(+自身)と
 *   actorのscopeNodeIdsに共通要素があるかを見る
 */
async function actorScopeCovers(orgId, actorScopeNodeIds, targetScopeNodeIds) {
  if (!actorScopeNodeIds || actorScopeNodeIds.length === 0) return true;
  if (!targetScopeNodeIds || targetScopeNodeIds.length === 0) return false;

  const orgRef = db.collection('organizations').doc(orgId);
  for (const nodeId of targetScopeNodeIds) {
    const nodeSnap = await orgRef.collection('nodes').doc(nodeId).get();
    if (!nodeSnap.exists) return false; // 存在しないnodeは安全側に倒してカバー不可扱い
    const node = nodeSnap.data();
    const nodeAndAncestors = [...(node.ancestorIds || []), nodeId];
    const covered = actorScopeNodeIds.some((s) => nodeAndAncestors.includes(s));
    if (!covered) return false;
  }
  return true;
}

/**
 * 実行者(uid)がorgId配下のロースール操作(閲覧/付与/編集/剥奪)を
 * 行えるかどうかを判定する。
 *
 * @param {string} uid 実行者
 * @param {string} orgId 対象団体
 * @param {string[]|null} targetScopeNodeIds
 *   対象(付与/編集/剥奪しようとしている名簿エントリ、またはこれから
 *   付与しようとしているscope)のscopeNodeIds。
 *   - null: 特定の対象を持たない操作(一覧閲覧、staffの付与/編集/剥奪 —
 *     staffはscopeを持たないため対象nodeでの判定が意味を持たない)。
 *     rootであるか、当該orgのadmin(scope問わず)でありさえすれば許可する
 *   - []: 団体全体スコープを対象とする操作(団体全体adminの付与/編集/剥奪)
 *   - [nodeId, ...]: 特定node配下スコープを対象とする操作
 * @returns {Promise<{
 *   allowed: boolean,
 *   actorType: 'root'|'org_admin_full'|'org_admin_scoped'|null,
 *   actorScopeNodeId: string|null,
 *   isOverride: boolean,
 * }>}
 */
async function resolveRosterAccess(uid, orgId, targetScopeNodeIds = null) {
  const member = await getOrgMember(orgId, uid);
  const hasOrgAdminMembership = !!(member && member.orgRole === 'admin');
  // [監査ログ 5.] isOverride は organizations/{orgId}/members/{actorUid} に
  // admin登録が無ければ常にtrue、という機械的な判定に固定する
  // (rootかどうか・scopeの一致有無とは独立に、そもそも当該orgの名簿に
  // admin登録されている本人かどうかだけで決まる)。
  const isOverride = !hasOrgAdminMembership;

  const root = await isSiteWideOrgManager(uid);
  if (root) {
    return { allowed: true, actorType: 'root', actorScopeNodeId: null, isOverride };
  }

  if (!hasOrgAdminMembership) {
    return { allowed: false, actorType: null, actorScopeNodeId: null, isOverride: true };
  }

  const actorScopeNodeIds = member.scopeNodeIds || [];
  const actorType = actorScopeNodeIds.length === 0 ? 'org_admin_full' : 'org_admin_scoped';
  const actorScopeNodeId = actorScopeNodeIds[0] ?? null;

  if (targetScopeNodeIds === null) {
    return { allowed: true, actorType, actorScopeNodeId, isOverride };
  }

  const covers = await actorScopeCovers(orgId, actorScopeNodeIds, targetScopeNodeIds);
  return { allowed: covers, actorType, actorScopeNodeId, isOverride };
}

module.exports = { resolveRosterAccess, getOrgMember, isSiteWideOrgManager, actorScopeCovers };
