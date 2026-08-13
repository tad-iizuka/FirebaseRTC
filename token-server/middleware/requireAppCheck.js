const { admin } = require('../lib/firebaseAdmin');

/**
 * middleware/requireAppCheck.js
 *
 * [背景] Phase14「Phase2展開に向けた仕上げ」の一項目。requireFirebaseAuth
 * (Firebase ID Token検証)は「誰がリクエストしたか」は保証するが、
 * 「正規のptt-client(Web)/ptt-ios/ptt-android自体からのリクエストか」は
 * 保証しない。正規のID Token・APIキーさえ入手できれば、スクリプトや改造アプリ
 * からでもtoken-serverを叩けてしまう。Firebase App Checkは、リクエスト元が
 * 「登録済みの実アプリ(Web=reCAPTCHA v3, iOS=App Attest, Android=Play
 * Integrity)」であることをプラットフォームの証明を通じて検証する仕組みで、
 * requireFirebaseAuthと組み合わせることで「誰が」「どのアプリから」の両方を
 * 満たせる。
 *
 * [段階的ロールアウトの方針]
 * App Checkは3クライアント全てのアプリストア配信・ユーザーへの行き渡りが
 * 完了するまでは、未対応の既存インストール済みアプリ(トークンを送ってこない)
 * を弾くと即断線になる。そのため、Guestロール導入(十四訂で「サーバー側の
 * 挙動を変える判断は都度ユーザー確認の上で」という方針を踏襲)と同様、
 * 検証はするが即座に拒否はしない「soft-enforce」を既定動作とする。
 *
 * - 既定(APP_CHECK_ENFORCE 未設定 または "false"): ヘッダーが無い/検証に
 *   失敗しても、警告ログを出すだけでリクエストは通す(req.appCheckVerified
 *   に真偽値をセットし、以降のルート側で参照できるようにするだけに留める)。
 *   これにより、旧バージョンのアプリが行き渡っている間の実害を避けつつ、
 *   ログから「どれだけのリクエストが未対応クライアントから来ているか」を
 *   観測し、enforceへの切り替えタイミングを判断できる。
 * - APP_CHECK_ENFORCE=true: ヘッダーが無い/検証に失敗したリクエストを
 *   401で拒否する。3クライアント側の対応が出揃い、CI/ストア配信を経て
 *   実機での動作確認が取れてから切り替えること(六訂・八訂・十七訂で
 *   踏んだのと同じ「実配布・CI合格の確認を経てから本番挙動を変える」
 *   進め方に倣う)。
 *
 * [適用範囲] server.js側でグローバルミドルウェアとして登録し、
 * requireFirebaseAuthより前段(認証トークンの検証より安価なため)に置く。
 * ただし以下は対象外とし、この関数内でスキップする:
 *   - ヘルスチェック(`/`)
 *   - `/webhooks`: LiveKitサーバーからのサーバー間通信(署名検証で別途保護済み)。
 *     実際にはwebhooksルーターがexpress.json()より前・このミドルウェアより
 *     前に完結して応答するため二重の安全策だが、明示的にも除外しておく
 *   - `/internal`: Cloud Scheduler専用(requireInternalSecretで別途保護済み)。
 *     Cloud SchedulerのHTTPターゲットはApp Checkトークンを送れないため必須の除外
 */
function requireAppCheck(req, res, next) {
  if (req.path === '/' || req.path.startsWith('/webhooks') || req.path.startsWith('/internal')) {
    return next();
  }

  const enforce = process.env.APP_CHECK_ENFORCE === 'true';
  const token = req.header('X-Firebase-AppCheck');

  if (!token) {
    if (enforce) {
      return res.status(401).json({ error: 'App Checkトークンがありません' });
    }
    console.warn(`[AppCheck未送信・soft-enforceのため通過] path=${req.path}`);
    req.appCheckVerified = false;
    return next();
  }

  admin
    .appCheck()
    .verifyToken(token)
    .then(() => {
      req.appCheckVerified = true;
      next();
    })
    .catch((e) => {
      if (enforce) {
        console.warn(`[AppCheck検証失敗・拒否] path=${req.path} ${e.message}`);
        return res.status(401).json({ error: 'App Checkトークンが無効です' });
      }
      console.warn(`[AppCheck検証失敗・soft-enforceのため通過] path=${req.path} ${e.message}`);
      req.appCheckVerified = false;
      next();
    });
}

module.exports = { requireAppCheck };
