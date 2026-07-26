/**
 * lib/orgContext.js
 *
 * [Phase11] Roomが組織階層(organizations/nodes)のどこに所属するかを解決する
 * 共通ロジック。
 *
 * 呼び出し元が2箇所ある:
 *   - routes/rooms.js の GET /:roomId/org-context (roomメンバー向け、
 *     requireRoomMembershipで権限判定)
 *   - routes/admin.js の GET /admin/rooms/:roomId (管理者向け、
 *     rooms:monitor権限で判定)
 * 権限判定の方法は異なるが「room.orgId/nodeId/nodeAncestorIdsから
 * 団体名・パンくずを解決する」という計算そのものは同一のため、
 * ロジックの重複・将来の乖離を避ける目的でここに切り出す
 * (middleware/requireAuth.js の requireRoomMembership を切り出したのと
 * 同じ考え方)。
 */

const { db } = require('./firebaseAdmin');

/**
 * @param {object} room Firestoreから取得した rooms/{roomId} のデータ
 *   (orgId / nodeId / nodeAncestorIds フィールドを参照する)
 * @returns {Promise<{orgId: string|null, orgName: string|null, breadcrumb: Array<{nodeId: string, name: string, depth: number}>}>}
 */
async function resolveOrgContext(room) {
  if (!room || !room.orgId) {
    return { orgId: null, orgName: null, breadcrumb: [] };
  }

  const orgRef = db.collection('organizations').doc(room.orgId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    // orgIdが指しているはずの団体が見つからない(削除された等)。
    // 呼び出し側には無所属と同様に扱わせる。
    console.warn(`[orgContext] orgId=${room.orgId} に対応する団体が存在しません`);
    return { orgId: null, orgName: null, breadcrumb: [] };
  }

  const nodeIdsInOrder = [...(room.nodeAncestorIds || []), ...(room.nodeId ? [room.nodeId] : [])];
  let breadcrumb = [];
  if (nodeIdsInOrder.length > 0) {
    const nodeRefs = nodeIdsInOrder.map((id) => orgRef.collection('nodes').doc(id));
    const nodeSnaps = await db.getAll(...nodeRefs);
    breadcrumb = nodeSnaps
      .filter((s) => s.exists)
      .map((s) => ({ nodeId: s.id, name: s.data().name, depth: s.data().depth }));
  }

  return { orgId: room.orgId, orgName: orgSnap.data().name, breadcrumb };
}

module.exports = { resolveOrgContext };
