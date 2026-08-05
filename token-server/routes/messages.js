/**
 * テキストチャットAPI (Phase 5)、および添付ファイル(Phase 16)
 *
 * [設計方針]
 * LiveKitのData Channelは使わない。Data Channelはサーバーを経由せず
 * クライアント間で直接ブロードキャストされるため、
 *   - 送信前のモデレーション(NGワード等、将来必要になった場合)ができない
 *   - 途中参加者への履歴配信ができない
 *   - BANされたユーザーの読み取り遮断ができない(ban.js/firestore.rulesの
 *     仕組みと二重に強制力を持たせられない)
 * という欠点がある。そのため、書き込みは必ずこのAPI(Admin SDK経由)を通し、
 * Firestoreの `rooms/{roomId}/messages` を正とする。配信はクライアント側の
 * Firestoreリアルタイムリスナー(onSnapshot)に任せる
 * (routes/rooms.jsのBAN即時反映と全く同じ設計パターン)。
 *
 * [Phase16で追加] 画像・動画・PDFの添付。バイナリ自体はJSONボディに乗らない
 * ため、Text Eventと違い1本のAPI呼び出しでは完結しない。
 *   1. POST /:roomId/attachments/upload-url … GCS書き込み用の署名付きURLを発行
 *   2. クライアントがそのURLへ直接PUT(token-serverはバイナリを中継しない)
 *   3. POST /:roomId/messages に attachment としてstoragePath等を渡す。
 *      ここでGCS上の実体(contentType・サイズ)を検証してから確定する
 * 詳細はlib/attachments.js、要件はbrushup-plan.md「7.」を参照。
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../lib/firebaseAdmin');
const { requireFirebaseAuth, requireRoomMembership } = require('../middleware/requireAuth');
const { requireRoomPermission } = require('../lib/permissions');
const { requireInSession, requireNotBeforeStart } = require('../lib/roomSchedule');
const attachments = require('../lib/attachments');

const router = express.Router();

const MAX_TEXT_LENGTH = 2000;

// uidベース: token.jsのuidRateLimiterと同じ考え方(NAT配下の正規ユーザーを
// 巻き込みすぎない程度の閾値)。チャットは連投されやすいため少し広めにしている。
const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'メッセージの送信が多すぎます。しばらく待ってから再試行してください' },
  keyGenerator: (req) => req.firebaseUser?.uid || req.ip,
});

/**
 * POST /rooms/:roomId/attachments/upload-url [Phase16]
 * body: { contentType: string, fileName: string, size: number }
 *
 * ファイル実体のアップロード先GCSパスと、そこへの書き込み用署名付きURL
 * (5分間有効)を発行する。この時点ではまだメッセージは作成されない
 * (アップロード自体はtoken-serverを経由しないため)。
 *
 * サイズはこの時点では自己申告値のバリデーション(上限チェック)にのみ使う。
 * 実際に信頼できる値は、アップロード完了後にPOST /messagesがGCS上の
 * 実体メタデータから取得し直す(lib/attachments.js参照)。
 */
router.post(
  '/:roomId/attachments/upload-url',
  requireFirebaseAuth,
  requireRoomMembership,
  // [開始/終了時刻] アップロードは「送信」の一部とみなし、in_session限定とする
  // (開始前は何もできない・終了後はチャット閲覧のみのため)。
  requireInSession,
  requireRoomPermission('chat:attachment_upload'),
  chatRateLimiter,
  async (req, res) => {
    const uid = req.firebaseUser.uid;
    const { roomId } = req.params;
    const { contentType, fileName, size } = req.body || {};

    try {
      const result = await attachments.createUploadUrl({
        roomId,
        uid,
        contentType,
        fileName,
        declaredSize: size,
      });
      res.json(result);
    } catch (e) {
      if (e.httpStatus) {
        return res.status(e.httpStatus).json({ error: e.message });
      }
      console.error('[チャット添付: アップロードURL発行エラー]', e.message);
      res.status(500).json({ error: 'アップロードURLの発行に失敗しました' });
    }
  }
);

/**
 * POST /rooms/:roomId/messages
 * body: { text?: string, attachment?: { storagePath: string, fileName?: string } }
 *
 * text・attachmentの少なくとも一方が必須。attachmentがある場合、GCS上の
 * 実体を検証し(lib/attachments.js#verifyUploadedAttachment)、サムネイル生成
 * (ベストエフォート)・保持期限(団体単位、7.3参照)の算出を行ってから
 * Firestoreへ書き込む。
 *
 * requireRoomMembership を通すことで、BANされたユーザーは送信もできない
 * (routes/talk.js と同じミドルウェア共有)。
 *
 * [Phase12] `requireRoomPermission('chat:send')`を追加。
 * ROOM_OPERATIONSでは元々role不問と定義済みだったが、実装は
 * `requireRoomMembership`止まりだったため揃えた(挙動は変わらない)。
 */
router.post(
  '/:roomId/messages',
  requireFirebaseAuth,
  requireRoomMembership,
  // [開始/終了時刻] 送信はin_session限定。開始前は何もできず、終了後は
  // 「チャット閲覧のみ」(送信不可)のため(lib/roomSchedule.js参照)。
  requireInSession,
  requireRoomPermission('chat:send'),
  chatRateLimiter,
  async (req, res) => {
    const uid = req.firebaseUser.uid;
    const { roomId } = req.params;
    const text = String(req.body?.text || '').trim();
    const attachmentInput = req.body?.attachment;

    if (!text && !attachmentInput) {
      return res.status(400).json({ error: 'text または attachment のいずれかは必須です' });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `メッセージは${MAX_TEXT_LENGTH}文字以内にしてください` });
    }

    let attachmentData = null;
    if (attachmentInput) {
      try {
        const verified = await attachments.verifyUploadedAttachment({
          roomId,
          uid,
          storagePath: attachmentInput.storagePath,
          declaredFileName: attachmentInput.fileName,
        });

        // サムネイル生成・保持期限の算出はベストエフォート/非致命的な処理。
        // 失敗してもメッセージ送信自体は継続する。
        const thumbnailPath = await attachments.generateThumbnail(verified);

        const roomSnap = await db.collection('rooms').doc(roomId).get();
        const room = roomSnap.exists ? roomSnap.data() : null;
        const retentionDays = await attachments.resolveRetentionDays(room);
        const expiresAt = attachments.computeExpiresAt(retentionDays);

        attachmentData = {
          storagePath: verified.storagePath,
          thumbnailPath,
          contentType: verified.contentType,
          kind: verified.kind,
          fileName: verified.fileName,
          size: verified.size,
          expiresAt,
        };
      } catch (e) {
        if (e.httpStatus) {
          return res.status(e.httpStatus).json({ error: e.message });
        }
        console.error('[チャット添付: 検証エラー]', e.message);
        return res.status(500).json({ error: '添付ファイルの検証に失敗しました' });
      }
    }

    try {
      const displayName = req.roomMember.displayName || req.firebaseUser.email || uid;
      const messageData = {
        uid,
        displayName,
        text,
        createdAt: new Date(),
      };
      if (attachmentData) {
        messageData.attachment = attachmentData;
      }

      const messageRef = await db.collection('rooms').doc(roomId).collection('messages').add(messageData);

      console.log(
        `[chat送信] room=${roomId} uid=${uid} messageId=${messageRef.id}` +
          (attachmentData ? ` attachment=${attachmentData.kind}` : '')
      );
      res.status(201).json({ messageId: messageRef.id });
    } catch (e) {
      console.error('[chat送信エラー]', e.message);
      res.status(500).json({ error: 'メッセージの送信に失敗しました' });
    }
  }
);

/**
 * GET /rooms/:roomId/messages/:messageId/attachment-url [Phase16]
 * GET /rooms/:roomId/messages/:messageId/thumbnail-url [Phase16]
 *
 * 添付ファイル本体・サムネイルの短期署名付き読み取りURL(5分間有効)を
 * 都度発行する。recording.jsのdownload-urlと同じ考え方で、事前に長期URLを
 * 埋め込まず、閲覧のたびにこのAPIを呼ぶ設計とする(BAN即時遮断と同水準の
 * 強制力を持たせるため。発行済みURLそのものを即時失効させる手段はないが、
 * 有効期限を短くすることで実質的にカバーする)。
 */
router.get(
  '/:roomId/messages/:messageId/attachment-url',
  requireFirebaseAuth,
  requireRoomMembership,
  // [開始/終了時刻] 閲覧系はafter_endでも許可するためrequireNotBeforeStartを使う
  // (requireInSessionはafter_endも拒否してしまうため使わない)。
  requireNotBeforeStart,
  requireRoomPermission('chat:attachment_read'),
  async (req, res) => {
    await issueAttachmentDownloadUrl(req, res, 'storagePath');
  }
);

router.get(
  '/:roomId/messages/:messageId/thumbnail-url',
  requireFirebaseAuth,
  requireRoomMembership,
  requireNotBeforeStart,
  requireRoomPermission('chat:attachment_read'),
  async (req, res) => {
    await issueAttachmentDownloadUrl(req, res, 'thumbnailPath');
  }
);

async function issueAttachmentDownloadUrl(req, res, pathField) {
  const { roomId, messageId } = req.params;
  try {
    const messageSnap = await db.collection('rooms').doc(roomId).collection('messages').doc(messageId).get();
    if (!messageSnap.exists) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }
    const attachment = messageSnap.data().attachment;
    const storagePath = attachment ? attachment[pathField] : null;
    if (!storagePath) {
      return res.status(404).json({ error: '添付ファイルが見つかりません' });
    }

    const result = await attachments.createDownloadUrl(storagePath);
    res.json(result);
  } catch (e) {
    if (e.httpStatus) {
      return res.status(e.httpStatus).json({ error: e.message });
    }
    console.error('[チャット添付: ダウンロードURL発行エラー]', e.message);
    res.status(500).json({ error: 'ダウンロードURLの発行に失敗しました' });
  }
}

module.exports = router;
