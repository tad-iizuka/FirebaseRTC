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
const { db, auth } = require('../lib/firebaseAdmin');
const { logAdminAction } = require('../lib/auditLog');
const { requireFirebaseAuth, isValidRoomId } = require('../middleware/requireAuth');
const { requireAdminPermission } = require('../middleware/requireAdmin');
const { resolveRosterAccess, hasSitewideOrgReadAccess } = require('../lib/orgRoster');

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
 * [2026-08-02追加] 「この団体を閲覧できるか」の統一判定。
 * サイト全体の 'organizations:monitor'/'organizations:manage' 保持者
 * (rootを含む)、または当該orgIdの名簿にadmin登録されている本人
 * (団体全体admin・scope限定adminいずれも)であれば閲覧できる。
 *
 * GET /admin/organizations/:orgId(単体取得)・
 * GET /admin/organizations/:orgId/nodes(node一覧)で使う。一覧
 * (GET /admin/organizations)は引き続き 'organizations:monitor' 必須の
 * ままとする(全団体を横断的に見せる操作であり、scope限定adminに
 * 開放する理由が無いため)。
 */
async function canReadOrg(uid, orgId) {
  if (await hasSitewideOrgReadAccess(uid)) return true;
  const access = await resolveRosterAccess(uid, orgId, null);
  return access.allowed;
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
 * GET /admin/organizations/:orgId
 *
 * [2026-08-02追加] 団体単体取得。scope限定admin(サイト全体の
 * 'organizations:monitor'は持たず、`organizations/{orgId}/members`
 * 経由でのみ管理権限を持つユーザー)が、admin-dashboardの一覧
 * (GET /admin/organizations、'organizations:monitor'必須)を経由せずに
 * 自分の管理する団体を直接取得するための入口。レスポンス形状は
 * GET /admin/organizations の配列要素と同一。
 */
router.get('/organizations/:orgId', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { orgId } = req.params;
  if (!isValidId(orgId)) {
    return res.status(400).json({ error: 'orgId が不正です' });
  }

  try {
    const orgSnap = await db.collection('organizations').doc(orgId).get();
    if (!orgSnap.exists) {
      return res.status(404).json({ error: '団体が見つかりません' });
    }

    if (!(await canReadOrg(uid, orgId))) {
      return res.status(403).json({ error: '管理者権限がありません' });
    }

    const org = orgSnap.data();
    let roomCount = null;
    try {
      const countSnap = await db.collection('rooms').where('orgId', '==', orgId).count().get();
      roomCount = countSnap.data().count;
    } catch (e) {
      console.warn(`[組織階層] roomCount取得失敗 orgId=${orgId}: ${e.message}`);
    }

    res.json({
      orgId,
      name: org.name,
      industryProfile: org.industryProfile ?? null,
      ownerUid: org.ownerUid,
      roomCount,
      attachmentRetentionDays: org.attachmentRetentionDays ?? null,
      createdAt: org.createdAt?.toMillis?.() ?? null,
    });
  } catch (e) {
    console.error('[組織階層: 団体単体取得エラー]', e.message);
    res.status(500).json({ error: '団体の取得に失敗しました' });
  }
});

/**
 * GET /admin/organizations/:orgId/nodes
 *
 * 団体配下のnodeをフラット配列で返す(parentNodeIdを持たせ、ツリーの
 * 組み立てはクライアント側に委ねる。admin-dashboard側の表示形式を
 * このAPIで決め打ちしないため)。
 *
 * [2026-08-02変更] 'organizations:monitor'固定だった権限チェックを
 * canReadOrg()に変更した。scope限定adminが名簿(members)のscopeNodeIds
 * 選択UI用に自団体のnode一覧を取得できる必要があるため
 * (GET /admin/organizations/:orgId/members は元々canReadOrg相当の
 * 判定だったが、nodes側だけ取り残されていた)。
 */
router.get('/organizations/:orgId/nodes', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { orgId } = req.params;
  if (!isValidId(orgId)) {
    return res.status(400).json({ error: 'orgId が不正です' });
  }

  try {
    const orgSnap = await db.collection('organizations').doc(orgId).get();
    if (!orgSnap.exists) {
      return res.status(404).json({ error: '団体が見つかりません' });
    }

    if (!(await canReadOrg(uid, orgId))) {
      return res.status(403).json({ error: '管理者権限がありません' });
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
});

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
        // [バグ修正] nodeAncestorIdsは「祖先のみ」であるべきで、nodeId(自分自身)は
        // 含めない。node.ancestorIdsは既に「祖先のみ」の正しい定義で計算されている
        // (上記のnode作成時ロジック参照)ため、そのまま使う。lib/orgContext.jsの
        // resolveOrgContext()側でパンくず組み立て時にroom.nodeIdを別途末尾へ追加する
        // 設計になっており、ここでnodeIdまで含めてしまうと同じnodeがパンくずに
        // 二重に現れる不具合が発生する(旧実装のバグ)。
        nodeAncestorIds = [...(node.ancestorIds || [])];
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

/**
 * ==========================================================================
 * 組織ロースター(所属)API [実装着手 2026-08-01]
 *
 * `phase11-org-roster-design.md`(案C)の通り、ここで扱う「所属」は
 * アクセス制御の軸にしない。Roomに入れるか・何ができるかは、これまで
 * 通り rooms/{roomId}/members/{uid} の role だけで決まる。ここで管理する
 * のは、団体管理者が自団体の状況を横断的に見るための付帯情報と、
 * その付帯情報を管理するためのスコープ付き権限(admin/staff)である。
 *
 * 権限判定は lib/orgRoster.js#resolveRosterAccess に集約している
 * (brushup-plan.md 二十四訂の判定式をそのまま実装)。既存の
 * requireAdminPermission('organizations:manage'/'organizations:monitor')
 * とは別軸のため、ここではミドルウェアとして使わず、各ハンドラ内で
 * resolveRosterAccess の結果を見て403を返す。
 * ==========================================================================
 */

function isValidScopeNodeIds(v) {
  return Array.isArray(v) && v.every((id) => isValidId(id));
}

/**
 * scopeNodeIdsで指定された各nodeが、実際にこのorg配下に存在するかを
 * 検証する(orgId違いのnodeIdを紛れ込ませる抜け道を塞ぐ。
 * PATCH /admin/rooms/:roomId/org-assignment と同じ考え方)。
 */
async function assertNodesExist(orgRef, nodeIds) {
  const unique = [...new Set(nodeIds)];
  const snaps = await db.getAll(...unique.map((id) => orgRef.collection('nodes').doc(id)));
  const missing = snaps.filter((s) => !s.exists).map((s) => s.id);
  return { unique, missing };
}

/**
 * GET /admin/organizations/:orgId/members
 *
 * 名簿一覧。root、またはこの団体のadmin(scope問わず)であれば閲覧できる。
 * scope限定adminにも一覧全体を見せる(「対象Branch配下のstaffに限定した
 * 閲覧」のようなさらに絞った可視範囲は、招待コードの可視範囲(item4、
 * brushup-plan.md 6.)側の課題として別途検討する)。
 */
router.get('/organizations/:orgId/members', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  const { orgId } = req.params;
  if (!isValidId(orgId)) {
    return res.status(400).json({ error: 'orgId が不正です' });
  }

  try {
    const orgSnap = await db.collection('organizations').doc(orgId).get();
    if (!orgSnap.exists) {
      return res.status(404).json({ error: '団体が見つかりません' });
    }

    const access = await resolveRosterAccess(uid, orgId, null);
    if (!access.allowed) {
      return res.status(403).json({ error: '管理者権限がありません' });
    }

    const snap = await db.collection('organizations').doc(orgId).collection('members').get();
    const members = snap.docs.map((d) => {
      const m = d.data();
      return {
        uid: d.id,
        orgRole: m.orgRole,
        scopeNodeIds: m.scopeNodeIds || [],
        grantedAt: m.grantedAt?.toMillis?.() ?? null,
        grantedBy: m.grantedBy,
      };
    });

    await logAdminAction({
      actorUid: uid,
      action: 'org:member_view',
      targetUid: null,
      detail: { orgId, actorType: access.actorType, actorScopeNodeId: access.actorScopeNodeId, isOverride: access.isOverride },
    });

    res.json({ members });
  } catch (e) {
    console.error('[組織ロースター: 一覧エラー]', e.message);
    res.status(500).json({ error: '名簿の取得に失敗しました' });
  }
});

/**
 * POST /admin/organizations/:orgId/members/:targetUid
 * body: { orgRole: 'admin' | 'staff', scopeNodeIds?: string[] }
 *
 * 名簿への新規登録(所属付与)。既存エントリがある場合は409を返す
 * (scopeやroleの変更はPATCHを使う。作成と更新を分けているのは、
 * routes/rooms.js のBAN・moderator任命APIと同様「意図しない上書き」を
 * 事故で起こさないため)。
 *
 * [最初の団体管理者の代理登録(鶏卵問題)]
 * このエンドポイント自体が代理登録も兼ねる。まだ誰も管理者登録されて
 * いない団体でも、root(organizations:manage 保持者)であれば
 * resolveRosterAccess が無条件に許可を返すため、専用の別APIは不要
 * (lib/orgRoster.js 冒頭コメント参照)。
 *
 * 対象uidは先にMember(メール認証)登録済みである必要がある
 * (phase11-org-roster-design.md 6.1)。Firebase Authに存在しない
 * uidを指定した場合は404を返す。
 */
router.post(
  '/organizations/:orgId/members/:targetUid',
  requireFirebaseAuth,
  async (req, res) => {
    const actorUid = req.firebaseUser.uid;
    const { orgId, targetUid } = req.params;
    const { orgRole, scopeNodeIds } = req.body || {};

    if (!isValidId(orgId)) {
      return res.status(400).json({ error: 'orgId が不正です' });
    }
    if (!isValidId(targetUid)) {
      return res.status(400).json({ error: 'targetUid が不正です' });
    }
    if (orgRole !== 'admin' && orgRole !== 'staff') {
      return res.status(400).json({ error: "orgRole は 'admin' か 'staff' で指定してください" });
    }
    if (scopeNodeIds !== undefined && !isValidScopeNodeIds(scopeNodeIds)) {
      return res.status(400).json({ error: 'scopeNodeIds は文字列配列で指定してください' });
    }
    if (orgRole === 'staff' && scopeNodeIds !== undefined && scopeNodeIds.length > 0) {
      // staffはRoom roleのような細かい権限フラグを持たせない方針
      // (phase11-org-roster-design.md 5.)。scopeNodeIdsはadmin専用。
      return res.status(400).json({ error: 'staff には scopeNodeIds を指定できません' });
    }

    try {
      const orgRef = db.collection('organizations').doc(orgId);
      const orgSnap = await orgRef.get();
      if (!orgSnap.exists) {
        return res.status(404).json({ error: '団体が見つかりません' });
      }

      // staffの付与/剥奪は特定nodeでの判定を持たない(orgRoster.js参照)。
      // adminの付与は、指定scope(未指定/空なら団体全体)をactorがカバー
      // しているかで判定する。
      const targetScopeNodeIds = orgRole === 'staff' ? null : scopeNodeIds || [];
      const access = await resolveRosterAccess(actorUid, orgId, targetScopeNodeIds);
      if (!access.allowed) {
        return res.status(403).json({ error: '管理者権限がありません' });
      }

      if (orgRole === 'admin' && scopeNodeIds && scopeNodeIds.length > 0) {
        const { missing } = await assertNodesExist(orgRef, scopeNodeIds);
        if (missing.length > 0) {
          return res.status(404).json({ error: `scopeNodeIds にこの団体配下に存在しないnodeがあります: ${missing.join(', ')}` });
        }
      }

      const memberRef = orgRef.collection('members').doc(targetUid);
      const existing = await memberRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: '既に名簿に登録されています。変更はPATCHを使用してください' });
      }

      // 対象がMember(メール認証)登録済みであることを確認する
      // (phase11-org-roster-design.md 6.1「対象ユーザーは先にMember登録
      // 済みである必要がある」)。
      try {
        await auth.getUser(targetUid);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          return res.status(404).json({ error: '対象uidに対応するアカウントが見つかりません(先にMember登録が必要です)' });
        }
        throw e;
      }

      const now = new Date();
      const normalizedScopeNodeIds = orgRole === 'admin' ? [...new Set(scopeNodeIds || [])] : [];
      await memberRef.set({
        uid: targetUid, // [GET /admin/me の managedOrgIds 用] collectionGroupクエリで
        // uidを条件に絞り込めるよう、ドキュメントIDと同じ値を明示的に
        // フィールドとしても持たせる(lib/attachments.jsのexpiresAtと
        // 同じ考え方: ドキュメントIDだけではcollectionGroupクエリの
        // 絞り込み条件にできないため)。
        orgRole,
        scopeNodeIds: normalizedScopeNodeIds,
        grantedAt: now,
        grantedBy: actorUid,
      });

      await logAdminAction({
        actorUid,
        action: 'org:member_grant',
        targetUid,
        detail: {
          orgId,
          orgRole,
          scopeNodeIds: normalizedScopeNodeIds,
          targetNodeId: normalizedScopeNodeIds[0] ?? null,
          actorType: access.actorType,
          actorScopeNodeId: access.actorScopeNodeId,
          isOverride: access.isOverride,
        },
      });

      console.log(`[組織ロースター: 付与] orgId=${orgId} targetUid=${targetUid} orgRole=${orgRole} by=${actorUid}`);
      res.status(201).json({
        uid: targetUid,
        orgRole,
        scopeNodeIds: normalizedScopeNodeIds,
        grantedAt: now.getTime(),
        grantedBy: actorUid,
      });
    } catch (e) {
      console.error('[組織ロースター: 付与エラー]', e.message);
      res.status(500).json({ error: '名簿への登録に失敗しました' });
    }
  }
);

/**
 * PATCH /admin/organizations/:orgId/members/:targetUid
 * body: { orgRole?: 'admin' | 'staff', scopeNodeIds?: string[] }
 *
 * 既存の名簿エントリのrole/scope変更。scopeの拡大(自分の権限が及ばない
 * scopeへの書き換え)を防ぐため、変更前・変更後の両方のscopeをactorが
 * カバーしていることを要求する。
 */
router.patch(
  '/organizations/:orgId/members/:targetUid',
  requireFirebaseAuth,
  async (req, res) => {
    const actorUid = req.firebaseUser.uid;
    const { orgId, targetUid } = req.params;
    const { orgRole, scopeNodeIds } = req.body || {};

    if (!isValidId(orgId)) {
      return res.status(400).json({ error: 'orgId が不正です' });
    }
    if (!isValidId(targetUid)) {
      return res.status(400).json({ error: 'targetUid が不正です' });
    }
    if (orgRole !== undefined && orgRole !== 'admin' && orgRole !== 'staff') {
      return res.status(400).json({ error: "orgRole は 'admin' か 'staff' で指定してください" });
    }
    if (scopeNodeIds !== undefined && !isValidScopeNodeIds(scopeNodeIds)) {
      return res.status(400).json({ error: 'scopeNodeIds は文字列配列で指定してください' });
    }

    try {
      const orgRef = db.collection('organizations').doc(orgId);
      const memberRef = orgRef.collection('members').doc(targetUid);
      const existing = await memberRef.get();
      if (!existing.exists) {
        return res.status(404).json({ error: '名簿にこのuidのエントリが見つかりません' });
      }
      const current = existing.data();

      const nextOrgRole = orgRole ?? current.orgRole;
      const nextScopeNodeIds =
        nextOrgRole === 'staff' ? [] : scopeNodeIds !== undefined ? [...new Set(scopeNodeIds)] : current.scopeNodeIds || [];

      if (nextOrgRole === 'staff' && scopeNodeIds !== undefined && scopeNodeIds.length > 0) {
        return res.status(400).json({ error: 'staff には scopeNodeIds を指定できません' });
      }

      // 変更前・変更後の両方のscopeをactorがカバーしているか確認する
      // (staffはnode判定を持たないためnullで扱う)。
      const beforeTarget = current.orgRole === 'staff' ? null : current.scopeNodeIds || [];
      const afterTarget = nextOrgRole === 'staff' ? null : nextScopeNodeIds;

      const accessBefore = await resolveRosterAccess(actorUid, orgId, beforeTarget);
      if (!accessBefore.allowed) {
        return res.status(403).json({ error: '管理者権限がありません' });
      }
      const accessAfter = await resolveRosterAccess(actorUid, orgId, afterTarget);
      if (!accessAfter.allowed) {
        return res.status(403).json({ error: '変更後のscopeはあなたの管理範囲を超えています' });
      }

      if (nextOrgRole === 'admin' && nextScopeNodeIds.length > 0) {
        const { missing } = await assertNodesExist(orgRef, nextScopeNodeIds);
        if (missing.length > 0) {
          return res.status(404).json({ error: `scopeNodeIds にこの団体配下に存在しないnodeがあります: ${missing.join(', ')}` });
        }
      }

      await memberRef.update({ orgRole: nextOrgRole, scopeNodeIds: nextScopeNodeIds });

      await logAdminAction({
        actorUid,
        action: 'org:member_edit',
        targetUid,
        detail: {
          orgId,
          orgRole: nextOrgRole,
          scopeNodeIds: nextScopeNodeIds,
          targetNodeId: nextScopeNodeIds[0] ?? null,
          actorType: accessAfter.actorType,
          actorScopeNodeId: accessAfter.actorScopeNodeId,
          isOverride: accessAfter.isOverride,
        },
      });

      console.log(`[組織ロースター: 編集] orgId=${orgId} targetUid=${targetUid} orgRole=${nextOrgRole} by=${actorUid}`);
      res.json({ uid: targetUid, orgRole: nextOrgRole, scopeNodeIds: nextScopeNodeIds });
    } catch (e) {
      console.error('[組織ロースター: 編集エラー]', e.message);
      res.status(500).json({ error: '名簿の更新に失敗しました' });
    }
  }
);

/**
 * DELETE /admin/organizations/:orgId/members/:targetUid
 *
 * 名簿からの除名(所属剥奪)。転職(トレード相当)は「旧団体の名簿から
 * 削除 → 新団体の名簿へ追加」という2手順で表現する
 * (phase11-org-roster-design.md 6.2「5. 転職」)。Memberアカウント自体・
 * 過去のRoom参加履歴(監査ログ)には一切影響しない。
 */
router.delete(
  '/organizations/:orgId/members/:targetUid',
  requireFirebaseAuth,
  async (req, res) => {
    const actorUid = req.firebaseUser.uid;
    const { orgId, targetUid } = req.params;

    if (!isValidId(orgId)) {
      return res.status(400).json({ error: 'orgId が不正です' });
    }
    if (!isValidId(targetUid)) {
      return res.status(400).json({ error: 'targetUid が不正です' });
    }

    try {
      const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
      const existing = await memberRef.get();
      if (!existing.exists) {
        return res.status(404).json({ error: '名簿にこのuidのエントリが見つかりません' });
      }
      const current = existing.data();
      const targetScopeNodeIds = current.orgRole === 'staff' ? null : current.scopeNodeIds || [];

      const access = await resolveRosterAccess(actorUid, orgId, targetScopeNodeIds);
      if (!access.allowed) {
        return res.status(403).json({ error: '管理者権限がありません' });
      }

      await memberRef.delete();

      await logAdminAction({
        actorUid,
        action: 'org:member_revoke',
        targetUid,
        detail: {
          orgId,
          orgRole: current.orgRole,
          scopeNodeIds: current.scopeNodeIds || [],
          targetNodeId: (current.scopeNodeIds || [])[0] ?? null,
          actorType: access.actorType,
          actorScopeNodeId: access.actorScopeNodeId,
          isOverride: access.isOverride,
        },
      });

      console.log(`[組織ロースター: 剥奪] orgId=${orgId} targetUid=${targetUid} by=${actorUid}`);
      res.json({ uid: targetUid, revoked: true });
    } catch (e) {
      console.error('[組織ロースター: 剥奪エラー]', e.message);
      res.status(500).json({ error: '名簿からの除名に失敗しました' });
    }
  }
);

module.exports = router;
