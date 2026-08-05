/**
 * middleware/requireInternalSecret.js
 *
 * [背景] 終了時刻を過ぎたRoomを定期的に検知して強制退出させる処理
 * (routes/internal.js の POST /internal/rooms/sweep-expired)は、
 * 通常のユーザー・管理者どちらからも呼ばれるべきではなく、Cloud Scheduler等の
 * 定期実行基盤からのみ呼ばれる想定。
 *
 * [方式選定] Cloud Run自体の`--no-allow-unauthenticated`(サービス単位の
 * IAM認証)は、このtoken-server自体が単一のCloud Runサービスとして
 * 一般ユーザー向けAPI(未認証で叩けるtoken発行等)も同居させているため
 * 使えない(サービス全体が認証必須になってしまう)。別サービスに切り出す
 * ほどの規模でもないため、webhooks.js(LiveKit Webhookの署名検証)とは別の
 * 単純な共有シークレット方式をここに実装する。Cloud SchedulerのHTTPターゲット
 * はカスタムヘッダーを設定できるため、追加のライブラリ(OIDC検証等)を
 * 導入せずに済む。
 *
 * [設定] 環境変数 INTERNAL_SWEEP_SECRET に十分ランダムな文字列を設定し、
 * Cloud SchedulerジョブのHTTPターゲットヘッダーに
 * `X-Internal-Sweep-Secret: <同じ値>` を設定しておくこと。
 */
function requireInternalSecret(req, res, next) {
  const expected = process.env.INTERNAL_SWEEP_SECRET;
  if (!expected) {
    // 未設定のまま本番稼働させると誰でも叩けてしまうため、フェイルクローズする。
    console.error('[requireInternalSecret] INTERNAL_SWEEP_SECRET が未設定です');
    return res.status(503).json({ error: '内部エンドポイントが未設定です' });
  }
  const provided = req.get('X-Internal-Sweep-Secret');
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: '認証に失敗しました' });
  }
  next();
}

module.exports = { requireInternalSecret };
