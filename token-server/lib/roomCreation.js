/**
 * lib/roomCreation.js
 *
 * [ルーム作成のadmin-dashboard移管]
 * 以前は routes/rooms.js の `POST /rooms`(ptt-client等、呼び出しユーザー
 * 自身がownerになる作成)だけがルーム作成経路だったが、`POST /admin/rooms`
 * (admin-dashboard専用、rooms:create権限)を追加するにあたり、
 *   - 招待コードの生成
 *   - rooms/{roomId} ドキュメントの作成
 *   - 作成者をownerとするmembersドキュメントの作成
 * という一連の処理が2箇所で重複しないよう、共通処理をここに集約する
 * (lib/permissions.js を「role×操作」の対応表として一本化したのと
 * 同じ考え方)。
 *
 * [ルーム名] 今回追加したフィールド。voice-onlyだったルームに、
 * admin-dashboardで閲覧・変更できる表示名を持たせる(brushup-plan.md参照)。
 * 未設定は null(旧仕様のルームや、名前を指定せず作成した場合)。
 */

const crypto = require('crypto');
const { db } = require('./firebaseAdmin');

const DEFAULT_MAX_MEMBERS = 20;
const MAX_ROOM_NAME_LENGTH = 100;

/**
 * 人が手入力・共有しやすい8文字の招待コードを生成する。
 * 紛らわしい文字(0/O, 1/I/L等)は除外している。
 */
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

/**
 * ルーム名の入力値を正規化する。空文字・未指定・文字列以外はnull(未設定)。
 * 上限文字数を超える場合は切り詰める(nameは必須項目ではないため、
 * 超過をエラーにはせず寛容に扱う)。
 */
function normalizeRoomName(rawName) {
  if (typeof rawName !== 'string') return null;
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_ROOM_NAME_LENGTH);
}

/**
 * maxMembersの入力値を検証する。未指定はデフォルト値。
 * @returns {{ error: string } | { value: number }}
 */
function resolveMaxMembers(rawMaxMembers) {
  if (rawMaxMembers === undefined || rawMaxMembers === null) {
    return { value: DEFAULT_MAX_MEMBERS };
  }
  if (!Number.isInteger(rawMaxMembers) || rawMaxMembers < 2 || rawMaxMembers > 200) {
    return { error: 'maxMembers は 2〜200 の範囲で指定してください' };
  }
  return { value: rawMaxMembers };
}

/**
 * ルームと、そのownerとなるmembersドキュメントを作成する。
 *
 * @param {object} params
 * @param {string} params.ownerUid
 * @param {string} params.ownerDisplayName
 * @param {string | null} [params.name]
 * @param {number} [params.maxMembers]
 * @returns {Promise<{roomId: string, inviteCode: string, name: string|null, maxMembers: number, createdAt: Date}>}
 */
async function createRoomAndOwnerMember({ ownerUid, ownerDisplayName, name, maxMembers }) {
  const roomRef = db.collection('rooms').doc();
  const inviteCode = generateInviteCode();
  const resolvedName = normalizeRoomName(name);
  const createdAt = new Date();

  await roomRef.set({
    ownerUid,
    name: resolvedName,
    createdAt,
    visibility: 'invite_only',
    inviteCode,
    maxMembers,
    // [Phase9] ルームがアクティブになった瞬間(room_startedイベント)に
    // 自動で録音を開始するかどうか。デフォルトはfalse(従来通り手動開始)。
    settings: { autoRecording: false },
  });

  await roomRef.collection('members').doc(ownerUid).set({
    role: 'owner',
    displayName: ownerDisplayName,
    status: 'active',
    joinedAt: createdAt,
  });

  return { roomId: roomRef.id, inviteCode, name: resolvedName, maxMembers, createdAt };
}

module.exports = {
  DEFAULT_MAX_MEMBERS,
  MAX_ROOM_NAME_LENGTH,
  generateInviteCode,
  normalizeRoomName,
  resolveMaxMembers,
  createRoomAndOwnerMember,
};
