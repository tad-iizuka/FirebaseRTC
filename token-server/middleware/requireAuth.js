const { auth } = require('../lib/firebaseAdmin');

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

module.exports = { requireFirebaseAuth, isValidRoomId };
