#!/usr/bin/env node
/**
 * dev-tools/cleanup-expired-attachments.js [Phase16]
 *
 * チャット添付ファイル(rooms/{roomId}/messages/{messageId}.attachment)の
 * 保持期限(brushup-plan.md 7.3で確定: 団体単位・デフォルト30日、
 * token-server/lib/attachments.js#resolveRetentionDays が計算しexpiresAtとして
 * 保存する)を過ぎたものを削除する。
 *
 * [なぜFirestore標準のTTL機能(reports/auditLogsが使うexpireAt)を使わないか]
 * 標準TTLはFirestoreドキュメントを自動削除してくれるが、それより先にGCS側の
 * ファイル実体(本体・サムネイル)を消す機会が無くなってしまう
 * (ドキュメントが消えた後ではstoragePathが分からず、GCS上に孤児オブジェクトが
 * 残り続ける)。そのため添付ファイルについては、このスクリプトが
 *   1. 期限切れメッセージをcollectionGroupクエリで検出
 *   2. GCS実体を削除
 *   3. Firestoreドキュメントを削除(添付があったという事実ごと消す。
 *      テキストのみのメッセージはこの削除対象に含まれない)
 * という順序を明示的に制御する。
 *
 * [運用] Cloud Scheduler + Cloud Run Jobs(または単純にcronで定期実行できる
 * 任意の環境)から、1日1回程度の頻度で実行する想定。token-server/
 * phase16-operations.md にセットアップ手順をまとめている。
 *
 * 使い方:
 *   node dev-tools/cleanup-expired-attachments.js [--dry-run]
 *
 * 必要な環境変数(token-server本体と同じ認証情報を流用する):
 *   GOOGLE_APPLICATION_CREDENTIALS (Firestore用、Admin SDKのADC)
 *   ATTACHMENTS_GCS_BUCKET
 *   ATTACHMENTS_GCS_CREDENTIALS_JSON または ATTACHMENTS_GCS_KEY_FILE
 */

const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const { loadGcsCredentials } = require('../token-server/lib/gcsCredentials');

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 200; // 1回のクエリで処理する上限(暴走防止)

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function getBucket() {
  const bucketName = process.env.ATTACHMENTS_GCS_BUCKET;
  if (!bucketName) {
    throw new Error('ATTACHMENTS_GCS_BUCKET が未設定です');
  }
  const credentials = JSON.parse(
    loadGcsCredentials({
      jsonEnvVar: 'ATTACHMENTS_GCS_CREDENTIALS_JSON',
      keyFileEnvVar: 'ATTACHMENTS_GCS_KEY_FILE',
    })
  );
  const storage = new Storage({ credentials });
  return storage.bucket(bucketName);
}

async function deleteGcsObject(bucket, objectPath) {
  if (!objectPath) return;
  try {
    await bucket.file(objectPath).delete();
  } catch (e) {
    if (e.code !== 404) throw e;
    // 404(既に存在しない)はエラーにせず先へ進む(recording.jsの削除APIと同じ考え方)
  }
}

async function main() {
  const bucket = getBucket();
  const now = admin.firestore.Timestamp.now();

  // collectionGroup('messages') は全ルーム横断でmessagesサブコレクションを
  // 検索する。firestore.indexes.json に `attachment.expiresAt` の
  // COLLECTION_GROUP インデックスを追加済み(事前に `firebase deploy
  // --only firestore:indexes` が必要)。
  const snap = await db
    .collectionGroup('messages')
    .where('attachment.expiresAt', '<=', now)
    .limit(BATCH_SIZE)
    .get();

  console.log(`[添付ファイル クリーンアップ] 期限切れ候補: ${snap.size}件 (dryRun=${DRY_RUN})`);

  let deleted = 0;
  for (const doc of snap.docs) {
    const attachment = doc.data().attachment;
    if (!attachment) continue; // 念のため(クエリ条件的に無いはずだが安全側)

    console.log(`  - ${doc.ref.path} storagePath=${attachment.storagePath}`);
    if (DRY_RUN) continue;

    await deleteGcsObject(bucket, attachment.storagePath);
    await deleteGcsObject(bucket, attachment.thumbnailPath);
    await doc.ref.delete();
    deleted += 1;
  }

  console.log(`[添付ファイル クリーンアップ] 完了。削除件数: ${DRY_RUN ? 0 : deleted}`);
  if (snap.size === BATCH_SIZE) {
    console.log(
      `[添付ファイル クリーンアップ] 上限(${BATCH_SIZE}件)に達したため、まだ他に期限切れが残っている可能性があります。再実行してください。`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[添付ファイル クリーンアップ エラー]', e);
    process.exit(1);
  });
