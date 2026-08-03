/**
 * lib/badges.js
 *
 * [Phase13] バッジ基本機能のコアロジック。
 * 設計の元ネタは `phase13-badge-schema.md`(brushup-plan.md 六.1 item14で
 * 団体スコープなしの1マスタ構成に確定済み)。このファイルはそのスキーマ案の
 * 「サーバー側の実装」にあたる。
 *
 * コレクション構成:
 *   badges/{badgeId}       … バッジマスタ(団体スコープなし。Phase15で
 *                              orgId等を後付けする余地を残す)
 *   badgeGrants/{grantId}  … 付与/剥奪の履歴を保持する追記型レコード
 *                              (同一uid×badgeIdで同時にactiveなのは1件のみ)
 *   config/badgeDisplay    … 表示設定(単一ドキュメント)
 *
 * [設計上の変更点(実装時に確定): クライアントへのbadges直接公開はしない]
 * phase13-badge-schema.md「8. firestore.rules方針」は当初「badgesは全
 * クライアント読み取り可」としていたが、実装時に以下の理由で撤回し、
 * badges/badgeGrants/config いずれもクライアント直接読み取り不可(Admin SDK
 * 経由のAPIのみ)に統一した。
 *   - 参加者一覧の「最優先1個のみ表示」判定(badgeGrants×badges の突き合わせ、
 *     Guest仮想バッジの合成)をクライアント側(Web/iOS/Android 3言語)で
 *     それぞれ再実装すると、Phase12で問題視した「同じロジックの分散実装」
 *     を再発させてしまう。badgesを直接読めても、この判定ロジック自体は
 *     どのみちサーバー側に置く必要があり、公開する理由が薄れた
 *   - サーバー側で完全に計算済みの結果(topBadge等)を返すAPIに一本化した
 *     方が、Phase15で団体・業種プロファイル単位のマスタ切り替えが入った
 *     際も、変更箇所をサーバー側だけに閉じ込められる
 * (brushup-plan.md 二十訂・phase13-badge-schema.md該当箇所に追記済み)
 *
 * [Guestの役割バッジ]
 * Guestは`role === 'guest'`から都度算出する「仮想バッジ」として扱い、
 * badgeGrantsへの永続化は行わない(入退室のたびに書き込みが発生するのを
 * 避けるため。phase13-badge-schema.md「3.」参照)。
 */

const { db } = require('./firebaseAdmin');

const MAX_ACTIVE_BADGE_NAME_LENGTH = 50;
const MAX_BADGE_DESCRIPTION_LENGTH = 200;

const BADGE_CATEGORIES = ['role', 'skill', 'unit', 'rank', 'other'];
const BADGE_GRANT_METHODS = ['manual', 'auto', 'both'];

/**
 * Guestの役割バッジ(仮想)。badgeGrantsには実体を持たず、role==='guest'の
 * メンバーに対してこの固定値を都度合成する。badgeIdは実在のbadgesドキュメント
 * とは別体系であることが分かるよう 'virtual:' 接頭辞を付けている
 * (Firestoreのドキュメント自動採番IDと衝突しないようにするため)。
 */
const GUEST_ROLE_BADGE = {
  badgeId: 'virtual:role-guest',
  name: 'Guest',
  icon: '🔰',
  category: 'role',
  priority: 0,
};

/**
 * Firestoreの`in`クエリは最大30件までしか受け付けないため、
 * uid一覧をチャンクに分割するためのヘルパー。
 */
function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function isNonEmptyString(v, maxLength) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= maxLength;
}

/**
 * バッジマスタ作成時の入力値検証。エラーメッセージの文字列を返す
 * (問題なければnull)。
 */
function validateBadgeInput(body, { partial = false } = {}) {
  if (!partial || body.name !== undefined) {
    if (!isNonEmptyString(body.name, MAX_ACTIVE_BADGE_NAME_LENGTH)) {
      return `name は1〜${MAX_ACTIVE_BADGE_NAME_LENGTH}文字で指定してください`;
    }
  }
  if (!partial || body.icon !== undefined) {
    if (!isNonEmptyString(body.icon, 8)) {
      return 'icon は1〜8文字で指定してください(絵文字1〜数文字を想定)';
    }
  }
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string' || body.description.length > MAX_BADGE_DESCRIPTION_LENGTH) {
      return `description は${MAX_BADGE_DESCRIPTION_LENGTH}文字以内で指定してください`;
    }
  }
  if (!partial || body.category !== undefined) {
    if (!BADGE_CATEGORIES.includes(body.category)) {
      return `category は ${BADGE_CATEGORIES.join('/')} のいずれかを指定してください`;
    }
  }
  if (!partial || body.grantMethod !== undefined) {
    if (!BADGE_GRANT_METHODS.includes(body.grantMethod)) {
      return `grantMethod は ${BADGE_GRANT_METHODS.join('/')} のいずれかを指定してください`;
    }
  }
  if (!partial || body.priority !== undefined) {
    if (typeof body.priority !== 'number' || !Number.isFinite(body.priority)) {
      return 'priority は数値で指定してください';
    }
  }
  if (body.active !== undefined && typeof body.active !== 'boolean') {
    return 'active はboolean型で指定してください';
  }
  // [Room owner委譲フラグ] バッジ単位の単純なON/OFF(ユーザー確認済み、
  // 2026-08-04)。role単位の段階的な委譲(例: moderatorにも一部許可)は
  // 現時点では導入しない。
  if (body.grantableByRoomOwner !== undefined && typeof body.grantableByRoomOwner !== 'boolean') {
    return 'grantableByRoomOwner はboolean型で指定してください';
  }
  // [Phase13] 自動付与条件の中身の妥当性検証はPhase13の最小スコープ外
  // (phase13-badge-schema.md「2.1」参照。typeが未知でもバッチ側でスキップする
  // 設計のため、ここでは型のみチェックする)。
  if (body.autoGrantCondition !== undefined && body.autoGrantCondition !== null) {
    if (typeof body.autoGrantCondition !== 'object' || Array.isArray(body.autoGrantCondition)) {
      return 'autoGrantCondition はオブジェクトで指定してください';
    }
  }
  return null;
}

function badgeDocToJson(doc) {
  const data = doc.data();
  return {
    badgeId: doc.id,
    name: data.name,
    icon: data.icon,
    description: data.description ?? null,
    category: data.category,
    grantMethod: data.grantMethod,
    autoGrantCondition: data.autoGrantCondition ?? null,
    priority: data.priority,
    active: data.active,
    // [2026-08-04] Room owner委譲フラグ。既存のバッジドキュメントには
    // フィールド自体が無いため、未設定は false(委譲なし) として扱う。
    grantableByRoomOwner: data.grantableByRoomOwner ?? false,
    createdAt: data.createdAt?.toMillis?.() ?? null,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
    createdBy: data.createdBy,
  };
}

/** バッジマスタ一覧(active/非activeを問わず全件)。管理画面向け。 */
async function listBadges() {
  const snap = await db.collection('badges').orderBy('priority', 'desc').get();
  return snap.docs.map(badgeDocToJson);
}

async function createBadge({ actorUid, body }) {
  const error = validateBadgeInput(body, { partial: false });
  if (error) {
    const e = new Error(error);
    e.statusCode = 400;
    throw e;
  }
  const now = new Date();
  const ref = db.collection('badges').doc();
  await ref.set({
    name: body.name.trim(),
    icon: body.icon.trim(),
    description: body.description ? body.description.trim() : null,
    category: body.category,
    grantMethod: body.grantMethod,
    autoGrantCondition: body.autoGrantCondition ?? null,
    priority: body.priority,
    active: body.active !== undefined ? body.active : true,
    grantableByRoomOwner: body.grantableByRoomOwner === true,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
  });
  const snap = await ref.get();
  return badgeDocToJson(snap);
}

async function updateBadge({ badgeId, body }) {
  const error = validateBadgeInput(body, { partial: true });
  if (error) {
    const e = new Error(error);
    e.statusCode = 400;
    throw e;
  }
  const ref = db.collection('badges').doc(badgeId);
  const snap = await ref.get();
  if (!snap.exists) {
    const e = new Error('バッジが見つかりません');
    e.statusCode = 404;
    throw e;
  }

  const patch = { updatedAt: new Date() };
  for (const key of ['name', 'icon', 'description', 'category', 'grantMethod', 'autoGrantCondition', 'priority', 'active', 'grantableByRoomOwner']) {
    if (body[key] !== undefined) {
      patch[key] = typeof body[key] === 'string' ? body[key].trim() : body[key];
    }
  }
  await ref.update(patch);
  const updated = await ref.get();
  return badgeDocToJson(updated);
}

/**
 * 指定uid集合に対する「現在activeなbadgeGrants」を取得し、
 * uidごとの配列にまとめて返す(badgesマスタとの突き合わせは行わない。
 * 呼び出し側でbadgeIdからマスタ情報を引く)。
 */
async function fetchActiveGrantsByUids(uids) {
  const result = new Map(uids.map((uid) => [uid, []]));
  if (uids.length === 0) return result;

  const chunks = chunk(uids, 30); // Firestore `in` の上限
  for (const uidChunk of chunks) {
    const snap = await db
      .collection('badgeGrants')
      .where('uid', 'in', uidChunk)
      .where('status', '==', 'active')
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const list = result.get(data.uid) || [];
      list.push({ grantId: doc.id, badgeId: data.badgeId, grantedAt: data.grantedAt });
      result.set(data.uid, list);
    }
  }
  return result;
}

/**
 * 指定badgeId集合に対応するbadgesマスタドキュメントをまとめて取得する。
 * 存在しない(削除された)badgeIdは結果に含めない。
 */
async function fetchBadgeMasterMap(badgeIds) {
  const uniqueIds = Array.from(new Set(badgeIds));
  const map = new Map();
  if (uniqueIds.length === 0) return map;

  // Admin SDKでは db.getAll(...refs) を使って複数ドキュメントを一括取得する。
  const refs = uniqueIds.map((id) => db.collection('badges').doc(id));
  const snaps = await db.getAll(...refs);
  for (const snap of snaps) {
    if (snap.exists) {
      map.set(snap.id, badgeDocToJson(snap));
    }
  }
  return map;
}

/**
 * Room参加者一覧向け: 指定Roomのmembers(uid, role)一覧を受け取り、
 * uidごとの{ badges: [...], topBadge }を計算して返す。
 * (phase13-badge-schema.md「4.3 案A(読み取り時計算)」の実装)
 *
 * @param {Array<{uid: string, role: string}>} members
 * @returns {Promise<Record<string, {badges: object[], topBadge: object|null}>>}
 */
async function getBadgesForRoomMembers(members) {
  const nonGuestUids = members.filter((m) => m.role !== 'guest').map((m) => m.uid);
  const grantsByUid = await fetchActiveGrantsByUids(nonGuestUids);

  const allBadgeIds = Array.from(grantsByUid.values()).flatMap((list) => list.map((g) => g.badgeId));
  const badgeMasterMap = await fetchBadgeMasterMap(allBadgeIds);

  const result = {};
  for (const member of members) {
    const badgeList = [];

    if (member.role === 'guest') {
      // [Guestの役割バッジ] badgeGrantsを問わず、roleから直接合成する。
      badgeList.push({ ...GUEST_ROLE_BADGE, source: 'guest-role' });
    } else {
      const grants = grantsByUid.get(member.uid) || [];
      for (const grant of grants) {
        const master = badgeMasterMap.get(grant.badgeId);
        if (master && master.active) {
          badgeList.push({ ...master, source: 'grant' });
        }
      }
    }

    badgeList.sort((a, b) => b.priority - a.priority);
    result[member.uid] = {
      badges: badgeList,
      topBadge: badgeList[0] ?? null,
    };
  }
  return result;
}

/**
 * 手動付与(Owner操作)。同一uid×badgeIdで既にactiveな付与がある場合は
 * 409エラーを投げる(phase13-badge-schema.md「4.1」の一意性ルール)。
 * Guestを対象にした付与は拒否する(5.3「Guestの対象範囲」)。
 *
 * @param {boolean} [viaRoomOwner=false]
 *   Room内owner専用API(routes/roomBadges.js)経由の呼び出しかどうか。
 *   trueの場合、バッジマスタの`grantableByRoomOwner`がtrueのバッジのみ
 *   許可する(2026-08-04、ユーザー要望により追加。「当日のリーダーアサイン」
 *   のような軽いバッジのみRoom ownerに委譲し、資格章・階級章のような
 *   重いバッジはサイト管理者専用のまま残す運用を想定)。
 *   admin-dashboard経由(routes/users.js、badges:manage権限)の呼び出しは
 *   falseのままとし、この制約を受けない(サイト管理者は委譲フラグに
 *   関わらず全バッジを操作できる)。
 */
async function grantBadge({ actorUid, targetUid, targetRole, badgeId, viaRoomOwner = false }) {
  if (targetRole === 'guest') {
    const e = new Error('Guestには資格・勤続バッジを付与できません(役割バッジのみ対象)');
    e.statusCode = 400;
    throw e;
  }

  const badgeRef = db.collection('badges').doc(badgeId);
  const badgeSnap = await badgeRef.get();
  if (!badgeSnap.exists || !badgeSnap.data().active) {
    const e = new Error('指定されたバッジは存在しないか、廃止済みです');
    e.statusCode = 404;
    throw e;
  }
  if (viaRoomOwner && !badgeSnap.data().grantableByRoomOwner) {
    const e = new Error('このバッジはRoom内ownerによる付与を許可されていません(管理者にご依頼ください)');
    e.statusCode = 403;
    throw e;
  }
  const grantMethod = badgeSnap.data().grantMethod;
  if (grantMethod !== 'manual' && grantMethod !== 'both') {
    const e = new Error('このバッジは手動付与できません(grantMethod=auto)');
    e.statusCode = 400;
    throw e;
  }

  return db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(
      db.collection('badgeGrants').where('uid', '==', targetUid).where('badgeId', '==', badgeId).where('status', '==', 'active')
    );
    if (!existingSnap.empty) {
      const e = new Error('このバッジは既に付与されています');
      e.statusCode = 409;
      throw e;
    }

    const now = new Date();
    const grantRef = db.collection('badgeGrants').doc();
    tx.set(grantRef, {
      uid: targetUid,
      badgeId,
      status: 'active',
      grantMethod: 'manual',
      grantedBy: actorUid,
      grantedAt: now,
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
      sourceConditionSnapshot: null,
    });
    return { grantId: grantRef.id, uid: targetUid, badgeId };
  });
}

/**
 * 手動剥奪(Owner操作)。既存のactiveなbadgeGrantsドキュメントを
 * revokedへ更新する(ドキュメントの削除はしない。履歴として残すため)。
 *
 * @param {boolean} [viaRoomOwner=false] grantBadge()と同じ意味。trueの
 *   場合、剥奪しようとしているバッジの現在の`grantableByRoomOwner`が
 *   trueであることを要求する。付与時にtrueだったバッジが後からfalseに
 *   変更された場合、Room ownerはそのバッジを剥奪できなくなる(管理者経由の
 *   剥奪は引き続き可能)。「委譲を絞る」運用側の意図をそのまま反映する
 *   挙動として妥当と判断し、付与時点の値をスナップショットする設計には
 *   していない。
 */
async function revokeBadge({ actorUid, targetUid, badgeId, reason = null, viaRoomOwner = false }) {
  if (viaRoomOwner) {
    const badgeSnap = await db.collection('badges').doc(badgeId).get();
    if (!badgeSnap.exists || !badgeSnap.data().grantableByRoomOwner) {
      const e = new Error('このバッジはRoom内ownerによる剥奪を許可されていません(管理者にご依頼ください)');
      e.statusCode = 403;
      throw e;
    }
  }
  return db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(
      db.collection('badgeGrants').where('uid', '==', targetUid).where('badgeId', '==', badgeId).where('status', '==', 'active')
    );
    if (existingSnap.empty) {
      const e = new Error('付与中のバッジが見つかりません');
      e.statusCode = 404;
      throw e;
    }
    const grantDoc = existingSnap.docs[0];
    tx.update(grantDoc.ref, {
      status: 'revoked',
      revokedBy: actorUid,
      revokedAt: new Date(),
      revokeReason: reason,
    });
    return { grantId: grantDoc.id, uid: targetUid, badgeId };
  });
}

const DEFAULT_MAX_DISPLAY_COUNT = 5;

async function getBadgeDisplayConfig() {
  const snap = await db.collection('config').doc('badgeDisplay').get();
  if (!snap.exists) {
    return { maxDisplayCount: DEFAULT_MAX_DISPLAY_COUNT, updatedAt: null, updatedBy: null };
  }
  const data = snap.data();
  return {
    maxDisplayCount: data.maxDisplayCount ?? DEFAULT_MAX_DISPLAY_COUNT,
    updatedAt: data.updatedAt?.toMillis?.() ?? null,
    updatedBy: data.updatedBy ?? null,
  };
}

async function setBadgeDisplayConfig({ actorUid, maxDisplayCount }) {
  if (!Number.isInteger(maxDisplayCount) || maxDisplayCount < 1 || maxDisplayCount > 20) {
    const e = new Error('maxDisplayCount は1〜20の整数で指定してください');
    e.statusCode = 400;
    throw e;
  }
  await db.collection('config').doc('badgeDisplay').set(
    { maxDisplayCount, updatedAt: new Date(), updatedBy: actorUid },
    { merge: true }
  );
  return getBadgeDisplayConfig();
}

/**
 * Room内owner向けUI(routes/roomBadges.js の GET /:roomId/badges)が
 * 「付与できるバッジの選択肢」を組み立てるための一覧。
 * `active && grantableByRoomOwner && grantMethod in [manual, both]`の
 * バッジのみを、必要最小限のフィールド(badgeId/name/icon/category)で返す。
 * autoGrantCondition・createdBy等の管理者向け情報は含めない
 * (Room ownerはbadges:monitor権限を持たない一般のRoomメンバーのため)。
 */
async function listRoomOwnerGrantableBadges() {
  const snap = await db
    .collection('badges')
    .where('active', '==', true)
    .where('grantableByRoomOwner', '==', true)
    .get();
  return snap.docs
    .map((doc) => ({ badgeId: doc.id, ...doc.data() }))
    .filter((data) => data.grantMethod === 'manual' || data.grantMethod === 'both')
    .map((data) => ({
      badgeId: data.badgeId,
      name: data.name,
      icon: data.icon,
      category: data.category,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

module.exports = {
  GUEST_ROLE_BADGE,
  BADGE_CATEGORIES,
  BADGE_GRANT_METHODS,
  listBadges,
  createBadge,
  updateBadge,
  getBadgesForRoomMembers,
  grantBadge,
  revokeBadge,
  getBadgeDisplayConfig,
  setBadgeDisplayConfig,
  listRoomOwnerGrantableBadges,
};
