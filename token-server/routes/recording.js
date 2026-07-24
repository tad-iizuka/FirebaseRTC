/**
 * 録音(Egress)管理API
 *
 * [設計方針]
 * LiveKitのRoom Composite Egressでルーム全体の音声を1本にミックスし、
 * S3(またはGCS)へ保存する。開始/停止はowner/moderatorのみ実行可能。
 * 録音中であることは lib/roomMetadata.js 経由でRoom Metadataに反映し、
 * 接続中の全参加者に「録音されていること」を開示する(同意の観点で必須)。
 *
 * [重要] /stop は「停止を依頼する」だけであり、その時点でrecording.active
 * をfalseに確定させることはしない。Egressの実際の終了(成功/失敗)は
 * 非同期にLiveKitから通知されるため、Firestore上の確定的な状態更新は
 * routes/webhooks.js の egress_ended イベント処理に一本化している。
 * (このAPIのレスポンスだけを見て「録音は終わった」と判断してはいけない)
 *
 * [Phase8で追加]
 *   - 録音開始/停止依頼のたびに lib/auditLog.js へ記録する。
 *   - GET /rooms/:roomId/recordings … 過去の録音履歴一覧
 *     (routes/webhooks.js の handleEgressEnded が rooms/{roomId}/recordings
 *     サブコレクションへ書き込む)。
 *   - GET /rooms/:roomId/recordings/:recordingId/download-url …
 *     owner/moderator限定のGCS署名付きダウンロードURL発行(5分間有効)。
 */

const fs = require('fs');
const express = require('express');
const { Storage } = require('@google-cloud/storage');
const { EgressClient, EncodedFileType, GCPUpload } = require('livekit-server-sdk');
const { db } = require('../lib/firebaseAdmin');
const { syncRoomMetadata } = require('../lib/roomMetadata');
const { logAdminAction } = require('../lib/auditLog');
const { requireFirebaseAuth, requireRoomMembership } = require('../middleware/requireAuth');

const router = express.Router();

const egressClient = new EgressClient(
  process.env.LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

// [Egress起動シグナルについて]
// Room Composite Egressはコンポジタ(ヘッドレスブラウザ)が「描画対象のトラックが
// 最低1つ存在する」ことを検知して初めて録画を開始する。この検知シグナルを
// 一定時間受け取れないと、LiveKit側は EGRESS_ABORTED(error: "Start signal not
// received") として自然終了する(実運用ログで確認済み)。
//
// [旧実装からの変更点]
// 以前は「録音開始APIを呼んだ瞬間に誰かが発話中(=マイクトラックがpublishされて
// いる)か」をここで同期チェックしていたが、PTTは発話中しかトラックが存在しない
// ため、この判定は(1)ほとんどの場合ブロックしてしまい実質録音を開始できない、
// (2)チェックが通ってもEgress起動のレイテンシにその発話自体が追い越され
// 「頭切れ」が起きる、という2つの問題があった。
// 現在はクライアント側(ptt-client/src/stores/connection.ts)が接続中ずっと
// 無音のkeep-aliveトラックをpublishし続ける運用に変更しており、ルームに
// 誰か1人でも接続していればEgressの起動シグナルは常に満たされる。そのため
// このファイルでは発話状態のチェックを行わない
// (自動録音のトリガーであるroom_startedイベント自体が「誰か接続した」ことの
// シグナルなので、routes/webhooks.js 側でも同様に不要)。

/**
 * GCSアップロード用サービスアカウントの認証情報(JSON文字列)を読み込む。
 *
 * [注意] これはFirebase Admin SDKが使うGOOGLE_APPLICATION_CREDENTIALSとは
 * 別物として扱う。GCPUploadのcredentialsフィールドは「JSON文字列そのもの」を
 * 要求するAPIであり、ADC(Application Default Credentials)の仕組みとは
 * 別経路のため、明示的に環境変数から読む必要がある。
 *
 * ローカル開発時は RECORDING_GCS_KEY_FILE (サービスアカウントJSONのパス)、
 * Cloud Run本番環境ではSecret Manager経由の RECORDING_GCS_CREDENTIALS_JSON
 * (JSON文字列そのもの)のいずれかを使う想定。
 * [Phase8] 署名付きダウンロードURLの発行にも同じ認証情報を流用する
 * (Cloud Run実行SAのADCだけでは署名できないため)。
 */
function loadGcsCredentials() {
  if (process.env.RECORDING_GCS_CREDENTIALS_JSON) {
    return process.env.RECORDING_GCS_CREDENTIALS_JSON;
  }
  if (process.env.RECORDING_GCS_KEY_FILE) {
    return fs.readFileSync(process.env.RECORDING_GCS_KEY_FILE, 'utf8');
  }
  throw new Error(
    'RECORDING_GCS_CREDENTIALS_JSON または RECORDING_GCS_KEY_FILE が未設定です'
  );
}

function buildOutput(roomId) {
  return {
    fileType: EncodedFileType.OGG,
    filepath: `recordings/${roomId}/${Date.now()}.ogg`,
    output: {
      case: 'gcp',
      value: new GCPUpload({
        credentials: loadGcsCredentials(),
        bucket: process.env.RECORDING_GCS_BUCKET,
      }),
    },
  };
}

/**
 * requireRoomMembership の後段で使う前提(req.roomMember が必要)。
 * BAN API(routes/rooms.js)と同じ権限モデル: owner/moderatorのみ許可。
 */
function requireModeratorOrOwner(req, res, next) {
  if (!['owner', 'moderator'].includes(req.roomMember.role)) {
    return res.status(403).json({ error: '権限がありません' });
  }
  next();
}

/**
 * Firestore仮登録 → Egress起動、の内部共通処理。
 *
 * 呼び出し元は2箇所:
 *   - POST /:roomId/recording/start (このファイル。moderator/ownerによる手動開始)
 *   - routes/webhooks.js の room_started イベントハンドラ
 *     (rooms/{roomId}.settings.autoRecording が true の場合の自動開始)
 *
 * 既に録音中の場合はEgressを呼ばずに null を返す(冪等)。エラーにするか
 * 黙って無視するかは呼び出し元の責務とする(手動APIは409を返したいが、
 * 自動起動側は「既に録っているなら何もしない」で正常なため)。
 *
 * Egress APIを呼ぶ前にFirestore側へ仮のactive状態を書き込むことで、
 * ほぼ同時に複数回呼ばれた場合(手動開始と自動開始が競合する場合を含む)の
 * 二重起動をトランザクションで防ぐ。
 */
async function startRecordingInternal(roomId, { startedByUid, trigger }) {
  const roomRef = db.collection('rooms').doc(roomId);

  const alreadyActive = await db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists) {
      throw { httpStatus: 404, message: 'ルームが見つかりません' };
    }
    if (snap.data().recording && snap.data().recording.active) {
      return true;
    }
    // egressIdはEgress API成功後に確定するため、まずnullで仮登録しておく
    tx.update(roomRef, {
      recording: {
        active: true,
        egressId: null,
        startedAt: new Date(),
        startedByUid: startedByUid ?? null,
        trigger, // 'manual' | 'auto' (Phase8で追加した録音履歴・監査ログでの識別用)
      },
    });
    return false;
  });

  if (alreadyActive) {
    return null;
  }

  let info;
  let output;
  try {
    output = buildOutput(roomId);
    info = await egressClient.startRoomCompositeEgress(
      roomId,
      { file: output },
      { audioOnly: true }
    );
  } catch (egressError) {
    // Egress API自体が失敗した場合は、仮登録したactive状態を必ず戻す
    await roomRef.update({ recording: null }).catch(() => {});
    throw egressError;
  }

  // [Phase8] 録音履歴一覧・ダウンロードURL発行のため、filepathも保存しておく。
  await roomRef.update({
    'recording.egressId': info.egressId,
    'recording.filepath': output.filepath,
  });
  await syncRoomMetadata(roomId);

  await logAdminAction({
    actorUid: startedByUid ?? null,
    action: 'recording:start',
    targetRoomId: roomId,
    detail: { egressId: info.egressId, trigger },
  });

  console.log(
    `[録音開始] room=${roomId} egressId=${info.egressId} trigger=${trigger} by=${startedByUid ?? '(auto)'}`
  );
  return { egressId: info.egressId };
}

/**
 * POST /rooms/:roomId/recording/start
 *
 * 既に録音中なら409(冪等ではなく明示的にエラーにする。「二重に録音が
 * 走っていないか」をUI側が誤認しないようにするため)。
 */
router.post(
  '/:roomId/recording/start',
  requireFirebaseAuth,
  requireRoomMembership,
  requireModeratorOrOwner,
  async (req, res) => {
    const { roomId } = req.params;
    const uid = req.firebaseUser.uid;

    try {
      const result = await startRecordingInternal(roomId, { startedByUid: uid, trigger: 'manual' });
      if (!result) {
        return res.status(409).json({ error: 'すでに録音中です' });
      }
      res.json({ started: true, egressId: result.egressId });
    } catch (e) {
      if (e && e.httpStatus) {
        return res.status(e.httpStatus).json({ error: e.message });
      }
      console.error('[録音開始エラー]', e.message);
      res.status(500).json({ error: '録音の開始に失敗しました' });
    }
  }
);

/**
 * POST /rooms/:roomId/recording/stop
 *
 * 停止を依頼するのみ。recording.active の解除は
 * routes/webhooks.js の egress_ended イベントで確定させる。
 * 冪等: 録音中でなければ何もせず成功を返す。
 */
router.post(
  '/:roomId/recording/stop',
  requireFirebaseAuth,
  requireRoomMembership,
  requireModeratorOrOwner,
  async (req, res) => {
    const { roomId } = req.params;
    const uid = req.firebaseUser.uid;
    const roomRef = db.collection('rooms').doc(roomId);

    try {
      const snap = await roomRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }
      const room = snap.data();
      if (!room.recording || !room.recording.active) {
        return res.json({ stopped: true }); // 元々録音中でなければ冪等に成功扱い
      }

      if (room.recording.egressId) {
        await egressClient.stopEgress(room.recording.egressId);
      }

      await logAdminAction({
        actorUid: uid,
        action: 'recording:stop_requested',
        targetRoomId: roomId,
        detail: { egressId: room.recording.egressId },
      });

      console.log(`[録音停止依頼] room=${roomId} egressId=${room.recording.egressId} by=${uid}`);
      // active:falseへの確定はegress_endedのWebhookで行うため、
      // ここでは「依頼が受理された」ことのみを返す。
      res.json({ stopping: true });
    } catch (e) {
      console.error('[録音停止エラー]', e.message);
      res.status(500).json({ error: '録音の停止に失敗しました' });
    }
  }
);

/**
 * GET /rooms/:roomId/recording/status
 * 現在の録音状態を確認する(ポーリング用途。通常はRoom Metadata経由の
 * リアルタイム通知で十分だが、入室直後の初期表示等で使うことを想定)。
 *
 * [Phase9] settings.autoRecording も併せて返す。/join のレスポンスは
 * 「招待コードで新規参加した瞬間」にしか autoRecording を返せないため、
 * 保存済みルームへの再入室時にも設定状態を取得できるよう、入室のたびに
 * 呼ばれるこのエンドポイントに持たせている(ptt-client/src/stores/room.ts
 * の fetchAutoRecording 参照)。
 */
router.get(
  '/:roomId/recording/status',
  requireFirebaseAuth,
  requireRoomMembership,
  async (req, res) => {
    try {
      const snap = await db.collection('rooms').doc(req.params.roomId).get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }
      const room = snap.data();
      const recording = room.recording || { active: false };
      res.json({
        active: !!recording.active,
        startedAt: recording.startedAt?.toMillis?.() ?? null,
        autoRecording: !!room.settings?.autoRecording,
      });
    } catch (e) {
      console.error('[録音状態取得エラー]', e.message);
      res.status(500).json({ error: '録音状態の取得に失敗しました' });
    }
  }
);

/**
 * GET /rooms/:roomId/recordings
 *
 * [Phase8] 録音履歴の一覧。routes/webhooks.js の handleEgressEnded() が
 * egress_ended 受信時に rooms/{roomId}/recordings/{egressId} へ書き込む。
 * 録音は「全参加者への開示」(README参照)という既存方針に合わせ、閲覧は
 * メンバーであれば誰でも可能とする(ダウンロードURL発行は別途owner/moderator限定)。
 */
router.get('/:roomId/recordings', requireFirebaseAuth, requireRoomMembership, async (req, res) => {
  try {
    const snap = await db
      .collection('rooms')
      .doc(req.params.roomId)
      .collection('recordings')
      .orderBy('startedAt', 'desc')
      .limit(100)
      .get();
    const recordings = snap.docs.map((d) => {
      const r = d.data();
      return {
        recordingId: d.id,
        startedAt: r.startedAt?.toMillis?.() ?? null,
        endedAt: r.endedAt?.toMillis?.() ?? null,
        status: r.status,
        startedByUid: r.startedByUid,
      };
    });
    res.json({ recordings });
  } catch (e) {
    console.error('[録音一覧取得エラー]', e.message);
    res.status(500).json({ error: '録音一覧の取得に失敗しました' });
  }
});

/**
 * GET /rooms/:roomId/recordings/:recordingId/download-url
 *
 * [Phase8] owner/moderatorのみ。GCS署名付きURL(5分間有効)を発行する。
 *
 * [注意] 署名付きURLの発行にはサービスアカウントの秘密鍵(またはIAM経由の
 * トークン署名権限)が必要。RECORDING_GCS_CREDENTIALS_JSON / KEY_FILEの
 * 認証情報をそのまま使い回すため、Cloud Run実行SAのADCだけでは署名できない。
 */
router.get(
  '/:roomId/recordings/:recordingId/download-url',
  requireFirebaseAuth,
  requireRoomMembership,
  requireModeratorOrOwner,
  async (req, res) => {
    const { roomId, recordingId } = req.params;
    try {
      const docRef = db.collection('rooms').doc(roomId).collection('recordings').doc(recordingId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: '録音が見つかりません' });
      }
      const recording = snap.data();

      // [重要] filepathはrecording/start時点(=アップロード成功が確定する前)に
      // 仮登録される値であり、webhooks.jsのhandleEgressEndedはstatusに関わらず
      // filepathをそのままrecordings履歴へコピーする。そのため
      // EGRESS_ABORTED/EGRESS_FAILEDのように録音が実際には完了しなかった
      // ケースでもfilepathは非nullのままであり、filepathの有無だけでは
      // 「ダウンロード可能かどうか」を判定できない。必ずstatusも確認する。
      if (!recording.filepath || recording.status !== 'EGRESS_COMPLETE') {
        return res.status(409).json({
          error: `この録音は正常に完了しなかったため、ダウンロードできません(status: ${recording.status ?? '不明'})`,
          code: 'recording_not_downloadable',
        });
      }

      const storage = new Storage({ credentials: JSON.parse(loadGcsCredentials()) });
      const bucket = storage.bucket(process.env.RECORDING_GCS_BUCKET);
      const file = bucket.file(recording.filepath);

      // [念のための実在確認] statusがEGRESS_COMPLETEであっても、保存先の
      // ライフサイクルポリシー等により実体が既に存在しない可能性はゼロでは
      // ないため、署名付きURLを発行する前に実在を確認し、存在しないファイルへの
      // URLを誤って返さないようにする(NoSuchKeyの再発防止)。
      const [exists] = await file.exists();
      if (!exists) {
        return res.status(404).json({
          error: '録音ファイルの実体が見つかりません(保存先から削除された可能性があります)',
          code: 'recording_file_missing',
        });
      }

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 5 * 60 * 1000,
      });

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: 'recording:download_url_issued',
        targetRoomId: roomId,
        detail: { recordingId },
      });

      res.json({ url, expiresInMs: 5 * 60 * 1000 });
    } catch (e) {
      console.error('[ダウンロードURL発行エラー]', e.message);
      res.status(500).json({ error: 'ダウンロードURLの発行に失敗しました' });
    }
  }
);

module.exports = router;
// routes/webhooks.js の room_started ハンドラ(自動録音)から利用する。
module.exports.startRecordingInternal = startRecordingInternal;
