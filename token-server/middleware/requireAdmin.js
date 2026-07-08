const { db } = require('../lib/firebaseAdmin');

/**
 * 汎用の管理者権限チェックミドルウェア。
 *
 * [設計方針]
 * 「管理者かどうか」を単一のbooleanではなく、UIDごとに付与された
 * permissions配列(例: 'rooms:monitor')で管理する。今後、権限の種類が
 * 増えても(例: 将来的な 'rooms:force-ban' 等)この仕組みのまま拡張できる
 * ようにするため。表示名等のプロフィール情報は rooms/{roomId}/members 側に
 * 別途持たせており、ここでは「権限の有無」だけを見る(関心を分離する)。
 *
 * データモデル (Firestore):
 *
 * adminUsers/{uid}
 *   - permissions: string[]      (例: ["rooms:monitor"])
 *   - grantedAt: timestamp
 *   - note: string | null        (何のための権限か、運用メモ用。任意)
 *
 * [権限の付与方法]
 * このコレクションを書き換えるAPIは現状用意していない。
 * dev-tools/grant-admin-permission.js でAdmin SDKを使い、運用者が
 * ローカルから直接付与/剥奪する(routes/rooms.jsにmoderator任命APIが
 * 無いのと同じ考え方: 「誰が新しい管理者を任命できるか」を安全に
 * 再帰的に守る仕組みができるまでは、フル権限を持つ運用者の手動操作に
 * 委ねる)。クライアントからのadminUsersへの直接読み書きは
 * firestore.rulesで拒否している。
 */
function requireAdminPermission(permission) {
  return async function (req, res, next) {
    const uid = req.firebaseUser.uid;
    try {
      const snap = await db.collection('adminUsers').doc(uid).get();
      const permissions = snap.exists ? snap.data().permissions || [] : [];
      if (!permissions.includes(permission)) {
        console.warn(`[管理者権限拒否] uid=${uid} required=${permission}`);
        return res.status(403).json({ error: '管理者権限がありません' });
      }
      next();
    } catch (e) {
      console.error('[管理者権限確認エラー]', e.message);
      res.status(500).json({ error: '権限確認に失敗しました' });
    }
  };
}

module.exports = { requireAdminPermission };
