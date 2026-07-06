const { auth, db } = require('../lib/firebaseAdmin');

/**
 * Authorization: Bearer <Firebase ID Token> を検証するミドルウェア。
 * 成功したら req.firebaseUser に decodedToken (uid, email, name 等) をセットする。
 * 検証失敗時は 401 を返して処理を止める。
 *
 * これ以降、クライアントが自己申告するidentity/uid相当の値は一切信用しない。
 * 常に req.firebaseUser.uid を正とする。
 */
async function requireFirebaseAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: '認証トークンがありません' });
  }

  try {
    const decodedToken = await auth.verifyIdToken(match[1]);
    req.firebaseUser = decodedToken;
    next();
  } catch (e) {
    console.warn('[認証エラー]', e.message);
    return res.status(401).json({ error: '認証トークンが無効です' });
  }
}

/**
 * FirestoreのドキュメントID・URLパスの両方で安全に使える文字だけを許可する。
 * roomIdはURLパラメータかつFirestoreドキュメントIDとして使うため、
 * ここで弾いておかないと Firestore の予約ID('.', '..' 等) や
 * パス区切り文字を含む値でおかしな挙動になる可能性がある。
 */
function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(roomId);
}

/**
 * ルームのメンバー(かつBANされていない)であることを確認するミドルウェア。
 * requireFirebaseAuthの後段で使う想定 (req.firebaseUser が必要)。
 *
 * [経緯] 元々 routes/token.js にインライン実装されていた判定ロジックを、
 * routes/talk.js でも同一の判定が必要になったため、判定ロジックの重複・
 * 将来の乖離を避ける目的でここに切り出した。roomId は req.params.roomId
 * から読む前提 (呼び出し側のルート定義で :roomId パスパラメータを使うこと)。
 */
async function requireRoomMembership(req, res, next) {
  const { roomId } = req.params;
  const uid = req.firebaseUser.uid;

  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }

  try {
    const memberSnap = await db.doc(`rooms/${roomId}/members/${uid}`).get();
    if (!memberSnap.exists) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }
    const member = memberSnap.data();
    if (member.status === 'banned') {
      return res.status(403).json({ error: 'このルームから排除されています' });
    }
    req.roomMember = member;
    next();
  } catch (e) {
    console.error('[メンバーシップ確認エラー]', e.message);
    res.status(500).json({ error: 'メンバーシップの確認に失敗しました' });
  }
}

module.exports = { requireFirebaseAuth, isValidRoomId, requireRoomMembership };
