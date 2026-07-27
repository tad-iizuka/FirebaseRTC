/**
 * 組織階層(Organizations/Nodes) 管理API (Phase 11)
 *
 * [設計方針]
 * README.mdのLong-Term Architecture(警備業: Company→Branch→Site、
 * 一般: Community→Group)を、業種に依存しない汎用の再帰ツリーとして表現する。
 *
 *   organizations/{orgId}                         … 団体(Company/Community)
 *   organizations/{orgId}/nodes/{nodeId}           … 階層ノード(Branch/Site、
 *                                                     あるいはGroup)。任意の
 *                                                     深さを許容する
 *                                                     (parentNodeIdで親を辿る)
 *
 * firestore.rulesでは organizations/nodes への直接読み書きを全面拒否している
 * (rooms本体と同じ理由: 「自分がこのorgId配下の何らかのroomのメンバーで
 * あるか」をrules内で安全に判定する手段がないため)。そのため、閲覧・作成・
 * 更新のすべてをこのAdmin SDK経由のAPIに一本化する。
 *
 * [権限] routes/admin.js の rooms:monitor / rooms:manage の使い分けを踏襲し、
 * 閲覧は organizations:monitor、作成・更新は organizations:manage を要求する。
 *
 * [ルームへの割り当て] PATCH /admin/rooms/:roomId/org-assignment は
 * rooms コレクションを更新するエンドポイントだが、「組織階層への
 * 割り当て」という関心が一致するため、このファイルにまとめている
 * (routes/rooms.js 側には置かない)。
 *
 * [スコープ外(2026-07-26時点)]
 * - 既存node の parentNodeId 変更(親付け替え)。配下nodeすべての
 *   ancestorIds再計算が連鎖する重い操作であり、5.4で挙げた懸念
 *   (バッジマスタの団体単位管理・監査ログの扱い)とも絡むため、
 *   必要になった時点で別途設計する
 * - organization/node の削除。配下nodeやRoomが参照している場合の挙動を
 *   別途検討する必要があるため、作成のみ先行実装する
 */

const express = require('express');
const { db } = require('../lib/firebaseAdmin');
const { logAdminAction } = require('../lib/auditLog');
const { requireFirebaseAuth, isValidRoomId } = require('../middleware/requireAuth');
const { requireAdminPermission } = require('../middleware/requireAdmin');

const router = express.Router();

const MAX_NAME_LENGTH = 100;

/**
 * orgId/nodeIdの文字種チェック。Firestoreの自動採番ID・カスタムIDの
 * どちらでも安全に使える文字だけを許可する(isValidRoomIdと同じ制約を
 * 流用。ドキュメントIDとしての安全性という意味では要件が同一のため)。
 */
function isValidId(id) {
  return isValidRoomId(id);
}

function isNonEmptyString(v, maxLength) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= maxLength;
}

/**
 * GET /admin/organizations
 *
 * 団体一覧。roomCountは都度Aggregation Queryで集計する(団体数が少ない
 * 前提での簡易実装。将来、団体数がスケールする場合は
 * organizations/{orgId}.roomCount のような非正規化カウンタへの
 * 切り替えを検討する)。
 */
router.get('/organizations', requireFirebaseAuth, requireAdminPermission('organizations:monitor'), async (req, res) => {
  try {
    const snap = await db.collection('organizations').orderBy('createdAt', 'desc').get();

    const organizations = await Promise.all(
      snap.docs.map(async (doc) => {
        const org = doc.data();
        let roomCount = null;
        try {
          const countSnap = await db.collection('rooms').where('orgId', '==', doc.id).count().get();
          roomCount = countSnap.data().count;
        } catch (e) {
          console.warn(`[組織階層] roomCount取得失敗 orgId=${doc.id}: ${e.message}`);
        }
        return {
          orgId: doc.id,
          name: org.name,
          industryProfile: org.industryProfile ?? null,
          ownerUid: org.ownerUid,
          roomCount,
          // [Phase16] チャット添付ファイルの保持期間(日数)。未設定ならnull
          // (呼び出し側でデフォルト30日を適用する。lib/attachments.js参照)。
          attachmentRetentionDays: org.attachmentRetentionDays ?? null,
          createdAt: org.createdAt?.toMillis?.() ?? null,
        };
      })
    );

    res.json({ organizations });
  } catch (e) {
    console.error('[組織階層: 団体一覧エラー]', e.message);
    res.status(500).json({ error: '団体一覧の取得に失敗しました' });
  }
});

/**
 * GET /admin/organizations/:orgId/nodes
 *
 * 団体配下のnodeをフラット配列で返す(parentNodeIdを持たせ、ツリーの
 * 組み立てはクライアント側に委ねる。admin-dashboard側の表示形式を
 * このAPIで決め打ちしないため)。
 */
router.get(
  '/organizations/:orgId/nodes',
  requireFirebaseAuth,
  requireAdminPermission('organizations:monitor'),
  async (req, res) => {
    const { orgId } = req.params;
    if (!isValidId(orgId)) {
      return res.status(400).json({ error: 'orgId が不正です' });
    }

    try {
      const orgSnap = await db.collection('organizations').doc(orgId).get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: '団体が見つかりません' });
      }

      const nodesSnap = await db
        .collection('organizations')
        .doc(orgId)
        .collection('nodes')
        .orderBy('depth', 'asc')
        .get();

      const nodes = nodesSnap.docs.map((d) => {
        const n = d.data();
        return {
          nodeId: d.id,
          name: n.name,
          parentNodeId: n.parentNodeId ?? null,
          depth: n.depth,
        };
      });

      res.json({ nodes });
    } catch (e) {
      console.error('[組織階層: node一覧エラー]', e.message);
      res.status(500).json({ error: 'nodeの一覧取得に失敗しました' });
    }
  }
);

/**
 * POST /admin/organizations
 * body: { name: string, industryProfile?: string }
 *
 * ownerUidはリクエストボディで受け取らず、認証トークンのuidを採用する
 * (自己申告によるなりすまし防止。Guestロールのrole自動判定と同じ考え方)。
 *
 * industryProfileは現時点ではバリデーションせず自由文字列として受理する
 * (Phase15で列挙型に絞る余地を残すため。5.4「業界ラベリング層は
 * Phase2要件確定まで着手条件待ち」という方針と整合させ、ここでは
 * 先回りして制約をかけない)。
 */
router.post('/organizations', requireFirebaseAuth, requireAdminPermission('organizations:manage'), async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { name, industryProfile } = req.body || {};

  if (!isNonEmptyString(name, MAX_NAME_LENGTH)) {
    return res.status(400).json({ error: `name は1〜${MAX_NAME_LENGTH}文字で指定してください` });
  }
  if (industryProfile !== undefined && typeof industryProfile !== 'string') {
    return res.status(400).json({ error: 'industryProfile は文字列で指定してください' });
  }

  try {
    const orgRef = db.collection('organizations').doc();
    const now = new Date();
    await orgRef.set({
      name: name.trim(),
      industryProfile: industryProfile ?? null,
      ownerUid: uid,
      createdAt: now,
    });

    await logAdminAction({
      actorUid: uid,
      action: 'organization:create',
      detail: { orgId: orgRef.id, name: name.trim(), industryProfile: industryProfile ?? null },
    });

    console.log(`[組織階層: 団体作成] orgId=${orgRef.id} name=${name.trim()} by=${uid}`);
    res.status(201).json({
      orgId: orgRef.id,
      name: name.trim(),
      industryProfile: industryProfile ?? null,
      ownerUid: uid,
      createdAt: now.getTime(),
    });
  } catch (e) {
    console.error('[組織階層: 団体作成エラー]', e.message);
    res.status(500).json({ error: '団体の作成に失敗しました' });
  }
});

/**
 * POST /admin/organizations/:orgId/nodes
 * body: { name: string, parentNodeId?: string | null }
 *
 * ancestorIds/depthはサーバー側で計算する(クライアントに計算させると
 * 不整合の温床になるため)。parentNodeId未指定 or nullなら直下(depth 0)。
 *
 * [循環参照について] 現時点ではnode作成のみをサポートし、既存nodeの
 * 親付け替えは行わないため、構造上サイクルは発生しない
 * (親は必ず自分より先に作られた既存nodeであり、自分自身や子孫を
 * 親に指定することはできない)。親付け替え機能を追加する際は
 * 別途サイクル検出が必要になる。
 */
router.post(
  '/organizations/:orgId/nodes',
  requireFirebaseAuth,
  requireAdminPermission('organizations:manage'),
  async (req, res) => {
    const uid = req.firebaseUser.uid;
    const { orgId } = req.params;
    const { name, parentNodeId } = req.body || {};

    if (!isValidId(orgId)) {
      return res.status(400).json({ error: 'orgId が不正です' });
    }
    if (!isNonEmptyString(name, MAX_NAME_LENGTH)) {
      return res.status(400).json({ error: `name は1〜${MAX_NAME_LENGTH}文字で指定してください` });
    }
    if (parentNodeId != null && !isValidId(parentNodeId)) {
      return res.status(400).json({ error: 'parentNodeId が不正です' });
    }

    try {
      const orgRef = db.collection('organizations').doc(orgId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: '団体が見つかりません' });
      }

      let ancestorIds = [];
      let depth = 0;

      if (parentNodeId) {
        const parentRef = orgRef.collection('nodes').doc(parentNodeId);
        const parentSnap = await parentRef.get();
        if (!parentSnap.exists) {
          return res.status(404).json({ error: 'parentNodeId で指定されたnodeが見つかりません' });
        }
        const parent = parentSnap.data();
        ancestorIds = [...(parent.ancestorIds || []), parentNodeId];
        depth = parent.depth + 1;
      }

      const nodeRef = orgRef.collection('nodes').doc();
      const now = new Date();
      await nodeRef.set({
        name: name.trim(),
        parentNodeId: parentNodeId ?? null,
        ancestorIds,
        depth,
        createdAt: now,
      });

      await logAdminAction({
        actorUid: uid,
        action: 'org_node:create',
        detail: { orgId, nodeId: nodeRef.id, name: name.trim(), parentNodeId: parentNodeId ?? null, depth },
      });

      console.log(`[組織階層: node作成] orgId=${orgId} nodeId=${nodeRef.id} depth=${depth} by=${uid}`);
      res.status(201).json({
        nodeId: nodeRef.id,
        name: name.trim(),
        parentNodeId: parentNodeId ?? null,
        ancestorIds,
        depth,
      });
    } catch (e) {
      console.error('[組織階層: node作成エラー]', e.message);
      res.status(500).json({ error: 'nodeの作成に失敗しました' });
    }
  }
);

/**
 * PATCH /admin/organizations/:orgId [Phase16]
 * body: { attachmentRetentionDays: number | null }
 *
 * 現時点ではチャット添付ファイルの保持期間(7.3で確定: 団体単位・
 * デフォルト30日)のみを更新対象とする。null を指定するとデフォルトへ戻す
 * (lib/attachments.js#resolveRetentionDaysがnull/未設定時はデフォルトを使う)。
 * name/industryProfileの更新はスコープ外のまま(Phase11時点で更新APIが
 * 無かったのと同様、必要になった時点で別途追加する)。
 */
router.patch(
  '/organizations/:orgId',
  requireFirebaseAuth,
  requireAdminPermission('organizations:manage'),
  async (req, res) => {
    const uid = req.firebaseUser.uid;
    const { orgId } = req.params;
    const { attachmentRetentionDays } = req.body || {};

    if (!isValidId(orgId)) {
      return res.status(400).json({ error: 'orgId が不正です' });
    }
    if (
      attachmentRetentionDays !== null &&
      (typeof attachmentRetentionDays !== 'number' ||
        !Number.isInteger(attachmentRetentionDays) ||
        attachmentRetentionDays <= 0)
    ) {
      return res.status(400).json({ error: 'attachmentRetentionDays は正の整数またはnullで指定してください' });
    }

    try {
      const orgRef = db.collection('organizations').doc(orgId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: '団体が見つかりません' });
      }

      await orgRef.update({ attachmentRetentionDays: attachmentRetentionDays ?? null });

      await logAdminAction({
        actorUid: uid,
        action: 'organization:update',
        detail: { orgId, attachmentRetentionDays: attachmentRetentionDays ?? null },
      });

      console.log(`[組織階層: 保持期間更新] orgId=${orgId} attachmentRetentionDays=${attachmentRetentionDays ?? '(デフォルト)'} by=${uid}`);
      res.json({ orgId, attachmentRetentionDays: attachmentRetentionDays ?? null });
    } catch (e) {
      console.error('[組織階層: 保持期間更新エラー]', e.message);
      res.status(500).json({ error: '保持期間の更新に失敗しました' });
    }
  }
);

/**
 * PATCH /admin/rooms/:roomId/org-assignment
 * body: { orgId: string | null, nodeId: string | null }
 *
 * Roomを組織階層へ割り当てる(既存Roomの移行方針: 強制バックフィルは
 * 行わず、団体を持つ運用者が任意のタイミングで手動アサインする)。
 * { orgId: null, nodeId: null } で無所属に戻せる(無所属は正式にサポート
 * する状態であり、エラーではない)。
 *
 * nodeIdは必ず「organizations/{orgId}/nodes」のサブコレクションとして
 * 取得するため、指定されたnodeIdが指定されたorgId配下に実在しない場合は
 * 自然に404になる(orgId違いのnodeIdを紐付けてしまう抜け道がない)。
 */
router.patch(
  '/rooms/:roomId/org-assignment',
  requireFirebaseAuth,
  requireAdminPermission('organizations:manage'),
  async (req, res) => {
    const uid = req.firebaseUser.uid;
    const { roomId } = req.params;
    const { orgId, nodeId } = req.body || {};

    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }
    if (orgId != null && !isValidId(orgId)) {
      return res.status(400).json({ error: 'orgId が不正です' });
    }
    if (nodeId != null && !isValidId(nodeId)) {
      return res.status(400).json({ error: 'nodeId が不正です' });
    }
    if (nodeId != null && orgId == null) {
      return res.status(400).json({ error: 'nodeId を指定する場合は orgId も必須です' });
    }

    try {
      const roomRef = db.collection('rooms').doc(roomId);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }

      // 無所属に戻すケース
      if (orgId == null) {
        await roomRef.update({ orgId: null, nodeId: null, nodeAncestorIds: [] });
        await logAdminAction({
          actorUid: uid,
          action: 'room:org_assign',
          targetRoomId: roomId,
          detail: { orgId: null, nodeId: null },
        });
        console.log(`[組織階層: room割り当て解除] roomId=${roomId} by=${uid}`);
        return res.json({ roomId, orgId: null, nodeId: null, nodeAncestorIds: [] });
      }

      const orgRef = db.collection('organizations').doc(orgId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: 'orgId で指定された団体が見つかりません' });
      }

      let nodeAncestorIds = [];
      if (nodeId) {
        const nodeSnap = await orgRef.collection('nodes').doc(nodeId).get();
        if (!nodeSnap.exists) {
          return res.status(404).json({ error: 'nodeId で指定されたnodeがこの団体配下に見つかりません' });
        }
        const node = nodeSnap.data();
        nodeAncestorIds = [...(node.ancestorIds || []), nodeId];
      }

      await roomRef.update({ orgId, nodeId: nodeId ?? null, nodeAncestorIds });

      await logAdminAction({
        actorUid: uid,
        action: 'room:org_assign',
        targetRoomId: roomId,
        detail: { orgId, nodeId: nodeId ?? null },
      });

      console.log(`[組織階層: room割り当て] roomId=${roomId} orgId=${orgId} nodeId=${nodeId ?? '(直下)'} by=${uid}`);
      res.json({ roomId, orgId, nodeId: nodeId ?? null, nodeAncestorIds });
    } catch (e) {
      console.error('[組織階層: room割り当てエラー]', e.message);
      res.status(500).json({ error: 'ルームの組織割り当てに失敗しました' });
    }
  }
);

module.exports = router;
