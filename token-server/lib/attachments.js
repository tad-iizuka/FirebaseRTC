/**
 * lib/attachments.js
 *
 * [Phase16] チャット添付ファイル(README.mdのCommunication ModelにおけるImage/
 * File Event。brushup-plan.md「7. Image/File Event要件たたき台」参照)。
 *
 * [対応ファイル種別] 画像・動画・PDFの3種類(7.1・7.3で確定)。
 * README.mdのCommunication Model定義には独立した「Video」Eventが無いため、
 * 動画はFile Eventの一種として扱う整理(画像=Image Event、動画/PDF=File Event、
 * という2Event・3ファイル種別の対応)。
 *
 * [保存先] recording.js(録音Egress)と同じ「専用GCSバケット＋専用サービス
 * アカウント」方式(brushup-plan.md 7.5で、実コード確認の結果Firebase Storage
 * 機能は使わないと確定)。Firebase Admin SDKのstorage()は使わず、
 * @google-cloud/storageを直接扱う。認証情報の読み込みはlib/gcsCredentials.js
 * を共有する。
 *
 * [書き込み経路] Text Event(routes/messages.js)と同様、メタデータの正は
 * Firestore(Admin SDK経由の書き込みのみ)。ただしファイル実体はJSONボディに
 * 乗らないため、以下の2段階フローを取る:
 *   1. POST /rooms/:roomId/attachments/upload-url でtoken-serverから
 *      GCS書き込み用の署名付きURLを発行してもらう
 *   2. クライアントがそのURLへ直接PUTしてアップロードする(token-serverを
 *      バイナリが経由しない。Cloud Runのリクエストサイズ・実行時間の制約を
 *      受けずに済む)
 *   3. アップロード完了後、POST /rooms/:roomId/messages のattachmentとして
 *      storagePath等を送る。この時点でtoken-server側がGCS上の実体
 *      (contentType・サイズ)を検証してから初めてFirestoreへメッセージとして
 *      確定する(クライアント自己申告のcontentType/sizeは信用しない。
 *      recording.jsのdownload-urlが署名発行前に実在確認しているのと同じ考え方)
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const { db } = require('./firebaseAdmin');
const { loadGcsCredentials } = require('./gcsCredentials');

const BUCKET_NAME = process.env.ATTACHMENTS_GCS_BUCKET;

// 7.3で確定した対応ファイル種別。README.mdのCommunication Model上の
// Event種別(Image/File)とは別に、内部的な処理分岐用の区分として持つ。
const CONTENT_TYPE_KIND = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'application/pdf': 'pdf',
};

const MAX_BYTES = 100 * 1024 * 1024; // 7.3で確定: 1件あたり100MB(安全弁)
const DEFAULT_RETENTION_DAYS = 30; // 7.3で確定: デフォルト30日(団体単位で上書き可)
const UPLOAD_URL_EXPIRES_MS = 5 * 60 * 1000; // recording.jsのdownload-urlと同じ考え方
const DOWNLOAD_URL_EXPIRES_MS = 5 * 60 * 1000;
const THUMBNAIL_MAX_DIMENSION = 320; // 7.3で確定: プレビューはサムネイル表示

function loadAttachmentsGcsCredentials() {
  return loadGcsCredentials({
    jsonEnvVar: 'ATTACHMENTS_GCS_CREDENTIALS_JSON',
    keyFileEnvVar: 'ATTACHMENTS_GCS_KEY_FILE',
  });
}

function getBucket() {
  if (!BUCKET_NAME) {
    throw new Error('ATTACHMENTS_GCS_BUCKET が未設定です');
  }
  const storage = new Storage({ credentials: JSON.parse(loadAttachmentsGcsCredentials()) });
  return storage.bucket(BUCKET_NAME);
}

function kindForContentType(contentType) {
  return CONTENT_TYPE_KIND[contentType] || null;
}

function isAllowedContentType(contentType) {
  return kindForContentType(contentType) !== null;
}

/** GCSオブジェクトパスとして安全な文字だけを残す(それ以外は`_`に置換)。 */
function sanitizeFileName(fileName) {
  const base = path.basename(String(fileName || 'file')).trim();
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
  return cleaned || 'file';
}

function httpError(status, message) {
  const err = new Error(message);
  err.httpStatus = status;
  return err;
}

/**
 * POST /rooms/:roomId/attachments/upload-url
 *
 * アップロード先のGCSパスをここで採番する。この時点ではまだメッセージ
 * (messageId)は存在しないため、パスは `attachments/{roomId}/{uid}/{uploadId}-
 * {fileName}` とし、「自分のuid配下のパスしか参照できない」という検証を
 * メッセージ作成時(verifyUploadedAttachment)に単純化できるようにしている。
 * (実ファイルの最終的な置き場所という意味では、録音Egressの
 * `recordings/{roomId}/{timestamp}.ogg` に相当する)
 */
async function createUploadUrl({ roomId, uid, contentType, fileName, declaredSize }) {
  if (!isAllowedContentType(contentType)) {
    throw httpError(400, '対応していないファイル形式です(画像・動画・PDFのみ対応しています)');
  }
  if (typeof declaredSize !== 'number' || !Number.isFinite(declaredSize) || declaredSize <= 0) {
    throw httpError(400, 'size は正の数値で指定してください');
  }
  if (declaredSize > MAX_BYTES) {
    throw httpError(400, `ファイルサイズは${MAX_BYTES / (1024 * 1024)}MB以内にしてください`);
  }

  const uploadId = crypto.randomUUID();
  const safeFileName = sanitizeFileName(fileName);
  const storagePath = `attachments/${roomId}/${uid}/${uploadId}-${safeFileName}`;

  const bucket = getBucket();
  const [uploadUrl] = await bucket.file(storagePath).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + UPLOAD_URL_EXPIRES_MS,
    contentType,
  });

  return { uploadUrl, storagePath, expiresInMs: UPLOAD_URL_EXPIRES_MS };
}

/**
 * POST /rooms/:roomId/messages のattachment検証。
 *
 * クライアント自己申告のcontentType/fileNameは信用せず、GCS上の実体
 * メタデータ(contentType・size)を正として扱う。実体が存在しない、
 * 許可されていない形式、上限超過のいずれかの場合はエラーにし、
 * 許可されない形式の場合は不正アップロードとしてオブジェクト自体も削除する
 * (ベストエフォート)。
 */
async function verifyUploadedAttachment({ roomId, uid, storagePath, declaredFileName }) {
  const expectedPrefix = `attachments/${roomId}/${uid}/`;
  if (typeof storagePath !== 'string' || !storagePath.startsWith(expectedPrefix)) {
    throw httpError(400, 'storagePath が不正です');
  }

  const bucket = getBucket();
  const file = bucket.file(storagePath);

  const [exists] = await file.exists();
  if (!exists) {
    throw httpError(400, 'アップロードされたファイルが見つかりません(先にアップロードURLへPUTしてください)');
  }

  const [metadata] = await file.getMetadata();
  const actualContentType = metadata.contentType;
  const actualSize = Number(metadata.size);

  if (!isAllowedContentType(actualContentType)) {
    await file.delete().catch(() => {});
    throw httpError(400, '対応していないファイル形式です(画像・動画・PDFのみ対応しています)');
  }
  if (!Number.isFinite(actualSize) || actualSize > MAX_BYTES) {
    await file.delete().catch(() => {});
    throw httpError(400, `ファイルサイズは${MAX_BYTES / (1024 * 1024)}MB以内にしてください`);
  }

  return {
    storagePath,
    contentType: actualContentType,
    kind: kindForContentType(actualContentType),
    size: actualSize,
    fileName: sanitizeFileName(declaredFileName),
  };
}

/**
 * サムネイル生成(ベストエフォート)。
 *
 * [設計方針] 7.3で「画像圧縮はクライアント側、サムネイル生成はサーバー側」
 * と確定している。生成に失敗してもメッセージ送信自体は失敗させない
 * (クライアント側は汎用アイコン表示にフォールバックする。recording.jsの
 * GCS削除がbest-effortなのと同じ考え方で、メイン処理を止めない)。
 *
 * 種別ごとの実装:
 *   - image: sharpでリサイズ
 *   - video: ffmpeg-static(バイナリ同梱、システムへのffmpegインストール不要)で
 *     先頭付近のフレームを抽出
 *   - pdf: pdfjs-dist(legacyビルド) + canvas で1ページ目をレンダリング
 * いずれも最終的にsharpで320px以内にリサイズしJPEGへ統一する。
 */
async function generateThumbnail({ storagePath, contentType, kind }) {
  let localSrc = null;
  try {
    const bucket = getBucket();
    const srcFile = bucket.file(storagePath);

    localSrc = path.join(os.tmpdir(), `attachment-src-${crypto.randomUUID()}`);
    await srcFile.download({ destination: localSrc });

    let rawBuffer;
    if (kind === 'image') {
      rawBuffer = fs.readFileSync(localSrc);
    } else if (kind === 'video') {
      rawBuffer = await extractVideoFrame(localSrc);
    } else if (kind === 'pdf') {
      rawBuffer = await renderPdfFirstPage(localSrc);
    } else {
      return null;
    }
    if (!rawBuffer) return null;

    // 依存パッケージはNode.js実行環境でのみ読み込む(必須ではない機能のため、
    // 未インストールでもチャット本体の送受信自体は壊さない)。
    const sharp = require('sharp');
    const thumbnailBuffer = await sharp(rawBuffer)
      .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();

    const thumbnailPath = `${storagePath}.thumb.jpg`;
    await bucket.file(thumbnailPath).save(thumbnailBuffer, { contentType: 'image/jpeg' });
    return thumbnailPath;
  } catch (e) {
    console.warn(`[チャット添付] サムネイル生成に失敗しました(送信処理は続行): storagePath=${storagePath} ${e.message}`);
    return null;
  } finally {
    if (localSrc) {
      fs.promises.unlink(localSrc).catch(() => {});
    }
  }
}

/** 動画の1秒地点のフレームをJPEGバイナリとして抽出する。 */
async function extractVideoFrame(localVideoPath) {
  const ffmpeg = require('fluent-ffmpeg');
  const ffmpegPath = require('ffmpeg-static');
  ffmpeg.setFfmpegPath(ffmpegPath);

  const outDir = os.tmpdir();
  const outName = `attachment-video-thumb-${crypto.randomUUID()}.jpg`;
  await new Promise((resolve, reject) => {
    ffmpeg(localVideoPath)
      .on('end', resolve)
      .on('error', reject)
      .screenshots({ timestamps: ['1'], filename: outName, folder: outDir, size: '640x?' });
  });
  const outPath = path.join(outDir, outName);
  const buffer = fs.readFileSync(outPath);
  await fs.promises.unlink(outPath).catch(() => {});
  return buffer;
}

/** PDFの1ページ目をPNGバイナリとしてレンダリングする。 */
async function renderPdfFirstPage(localPdfPath) {
  const { createCanvas } = require('canvas');
  // pdfjs-distはバージョンによりESM専業化が進んでいるため、Node(CommonJS)の
  // token-serverからそのまま使えるlegacyビルドをバージョン固定で利用する
  // (package.jsonでpdfjs-dist@3.11.174に固定。動作確認済み)。
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

  const data = new Uint8Array(fs.readFileSync(localPdfPath));
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toBuffer('image/png');
}

/**
 * GET .../attachment-url ・ .../thumbnail-url が使う短期署名付き読み取りURL。
 * recording.jsのdownload-url(5分間有効)と同じ考え方。BANされた瞬間、
 * 新規の署名URL発行ができなくなる(=間接的な即時失効)形で、Text Eventの
 * BAN即時遮断と同水準の強制力を持たせる。
 */
async function createDownloadUrl(storagePath) {
  const bucket = getBucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw httpError(404, 'ファイルが見つかりません');
  }
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + DOWNLOAD_URL_EXPIRES_MS,
  });
  return { url, expiresInMs: DOWNLOAD_URL_EXPIRES_MS };
}

/**
 * 保持期間(日数)の解決。7.3で確定した「団体(組織階層)単位で設定可能、
 * デフォルト30日」を実現する。Roomのorganizations/{orgId}.attachmentRetentionDays
 * を参照し、無所属Room・未設定の場合はデフォルトを使う。
 *
 * [設計上の注記] Phase13バッジシステムで「団体単位のマスタ管理はPhase13
 * 単体では成立しない」と判断した論拠(ユーザー×団体の所属関係が未実装)とは
 * 前提が異なる。保持期間は「Roomがどの団体に属するか」だけで決まればよく、
 * これはPhase11で実装済みの「Roomの組織階層への手動割り当て」がそのまま
 * 使える(brushup-plan.md 7.3参照)。
 */
async function resolveRetentionDays(room) {
  if (!room || !room.orgId) return DEFAULT_RETENTION_DAYS;
  try {
    const orgSnap = await db.collection('organizations').doc(room.orgId).get();
    if (!orgSnap.exists) return DEFAULT_RETENTION_DAYS;
    const days = orgSnap.data().attachmentRetentionDays;
    return typeof days === 'number' && days > 0 ? days : DEFAULT_RETENTION_DAYS;
  } catch (e) {
    console.warn(`[チャット添付] 保持期間の解決に失敗、デフォルト値(${DEFAULT_RETENTION_DAYS}日)を使用します: ${e.message}`);
    return DEFAULT_RETENTION_DAYS;
  }
}

function computeExpiresAt(retentionDays) {
  return new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * scripts/cleanup-expired-attachments.js が使う。GCS実体(本体・サムネイル)を
 * 削除する。Firestore側のTTL機能(reports/auditLogsが使っているexpireAt)は
 * ここでは使わない。TTLは「ドキュメントが消えた後にGCS側の実体を掃除する」
 * 手段を提供しないため、Firestore側のドキュメント削除より先にGCS側を
 * 消せるよう、専用のクリーンアップスクリプトから明示的に呼び出す設計とする
 * (phase16-operations.md参照)。
 */
async function deleteAttachmentFiles({ storagePath, thumbnailPath }) {
  const bucket = getBucket();
  await bucket
    .file(storagePath)
    .delete()
    .catch((e) => {
      if (e.code !== 404) throw e;
    });
  if (thumbnailPath) {
    await bucket
      .file(thumbnailPath)
      .delete()
      .catch((e) => {
        if (e.code !== 404) throw e;
      });
  }
}

module.exports = {
  MAX_BYTES,
  DEFAULT_RETENTION_DAYS,
  isAllowedContentType,
  kindForContentType,
  createUploadUrl,
  verifyUploadedAttachment,
  generateThumbnail,
  createDownloadUrl,
  resolveRetentionDays,
  computeExpiresAt,
  deleteAttachmentFiles,
};
