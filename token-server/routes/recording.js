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
 */

const fs = require('fs');
const express = require('express');
const { EgressClient, EncodedFileType, GCPUpload } = require('livekit-server-sdk');
const { db } = require('../lib/firebaseAdmin');
const { syncRoomMetadata } = require('../lib/roomMetadata');
const { requireFirebaseAuth, requireRoomMembership } = require('../middleware/requireAuth');

const router = express.Router();

const egressClient = new EgressClient(
  process.env.LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

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
 * POST /rooms/:roomId/recording/start
 *
 * 既に録音中なら409(冪等ではなく明示的にエラーにする。「二重に録音が
 * 走っていないか」をUI側が誤認しないようにするため)。
 * Egress APIを呼ぶ前にFirestore側へ仮のactive状態を書き込むことで、
 * ほぼ同時に複数回叩かれた場合の二重起動をトランザクションで防ぐ。
 */
router.post(
  '/:roomId/recording/start',
  requireFirebaseAuth,
  requireRoomMembership,
  requireModeratorOrOwner,
  async (req, res) => {
    const { roomId } = req.params;
    const uid = req.firebaseUser.uid;
    const roomRef = db.collection('rooms').doc(roomId);

    try {
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
            startedByUid: uid,
          },
        });
        return false;
      });

      if (alreadyActive) {
        return res.status(409).json({ error: 'すでに録音中です' });
      }

      let info;
      try {
        info = await egressClient.startRoomCompositeEgress(
          roomId,
          { file: buildOutput(roomId) },
          { audioOnly: true }
        );
      } catch (egressError) {
        // Egress API自体が失敗した場合は、仮登録したactive状態を必ず戻す
        await roomRef.update({ recording: null }).catch(() => {});
        throw egressError;
      }

      await roomRef.update({ 'recording.egressId': info.egressId });
      await syncRoomMetadata(roomId);

      console.log(`[録音開始] room=${roomId} egressId=${info.egressId} by=${uid}`);
      res.json({ started: true, egressId: info.egressId });
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
      const recording = snap.data().recording || { active: false };
      res.json({
        active: !!recording.active,
        startedAt: recording.startedAt?.toMillis?.() ?? null,
      });
    } catch (e) {
      console.error('[録音状態取得エラー]', e.message);
      res.status(500).json({ error: '録音状態の取得に失敗しました' });
    }
  }
);

module.exports = router;
