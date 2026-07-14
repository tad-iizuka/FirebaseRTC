/**
 * lib/auditLog.js
 *
 * 管理系操作(BAN・role変更・録音の強制操作・管理者権限の付与/剥奪・
 * 録音ダウンロードURL発行等)を一箇所から記録するモジュール。
 * lib/roomMetadata.js が「Room Metadataへの書き込みを一箇所に集約する」のと
 * 同じ考え方で、監査ログの書き込み経路を分散させない。
 *
 * [TTL] expireAt を書き込み時に計算してセットする。Firestore側のTTLポリシー
 * (`gcloud firestore fields ttls update expireAt --collection-group=auditLogs
 *   --enable-ttl`)を有効化しておくことで、このフィールドを過ぎたドキュメントは
 * バックグラウンドで自動的に削除される(即時ではなく、通常24時間以内)。
 * 手順は phase8-operations.md を参照。
 *
 * 監査ログの書き込み失敗で本来の操作(BAN等)自体を失敗させたくないため、
 * ベストエフォートで例外を握りつぶす(warnログのみ)。呼び出し側は
 * await するが、失敗しても本処理のレスポンスには影響しない。
 */

const { db } = require('./firebaseAdmin');

// reports/eventsより長め(監査目的のため。法務要件に応じて調整すること)。
const RETENTION_DAYS = 400;

/**
 * @param {object} params
 * @param {string} params.actorUid 操作を実行したユーザーのuid
 * @param {string} params.action 例: "room:ban", "room:role_change",
 *   "recording:start", "recording:stop_requested",
 *   "recording:download_url_issued", "admin:grant", "admin:revoke"
 * @param {string|null} [params.targetRoomId]
 * @param {string|null} [params.targetUid]
 * @param {object} [params.detail] アクション固有の付加情報
 */
async function logAdminAction({ actorUid, action, targetRoomId = null, targetUid = null, detail = {} }) {
  try {
    const now = new Date();
    const expireAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.collection('auditLogs').add({
      actorUid,
      action,
      targetRoomId,
      targetUid,
      detail,
      createdAt: now,
      expireAt,
    });
  } catch (e) {
    console.warn(`[auditLog] 記録に失敗しました action=${action}: ${e.message}`);
  }
}

module.exports = { logAdminAction };
