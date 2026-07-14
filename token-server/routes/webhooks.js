/**
 * LiveKit Webhook受信
 *
 * [設計方針]
 * routes/recording.js の /stop は「停止を依頼する」だけであり、実際に
 * Egressが終了した(成功/失敗いずれも含む)ことはLiveKitからの非同期
 * Webhookでしか確実に検知できない。そのため、Firestore上の
 * recording.active を false に確定させる処理はこのファイルに一本化する。
 *
 * 現状は egress_ended イベントのみ処理する。将来的に room_started /
 * room_finished 等の他イベントを扱う場合もこのファイルに追加していく想定。
 *
 * [重要] WebhookReceiver.receive() は署名検証のため「生のリクエストボディ
 * 文字列」を必要とする。server.js側でこのルートにだけ express.json() より
 * 前に express.raw() を適用しておくこと(このファイル単体では効かない)。
 *
 * [設定] LiveKit Cloud (または自前ホストLiveKit) の Webhook設定で、
 * このエンドポイント (https://<このサーバー>/webhooks/livekit) を
 * 登録しておく必要がある。署名検証にはLIVEKIT_API_KEY/LIVEKIT_API_SECRETを
 * そのまま流用するため、追加の秘密情報は不要。
 *
 * [Phase8で追加]
 * 録音履歴(一覧・ダウンロードAPI用)を rooms/{roomId}/recordings/{egressId}
 * サブコレクションへ書き残す。rooms/{roomId}.recording は「現在進行中の
 * 録音1件」だけを保持する設計のため、過去の録音を辿れるようにするには
 * ここで別途永続化する必要がある。
 */

const express = require('express');
const { WebhookReceiver } = require('livekit-server-sdk');
const { db } = require('../lib/firebaseAdmin');
const { syncRoomMetadata } = require('../lib/roomMetadata');

const router = express.Router();

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

/**
 * POST /webhooks/livekit
 */
router.post('/livekit', async (req, res) => {
  let event;
  try {
    // server.jsでexpress.raw()を適用しているため、req.bodyはBufferで届く
    event = await receiver.receive(req.body.toString('utf8'), req.get('Authorization'));
  } catch (e) {
    console.warn('[Webhook検証エラー]', e.message);
    return res.status(401).send('invalid signature');
  }

  try {
    if (event.event === 'egress_ended') {
      await handleEgressEnded(event.egressInfo);
    }
    // 他のイベント種別(room_started等)は現状無視する。
  } catch (e) {
    console.error('[Webhook処理エラー]', e.message);
    // LiveKit側の再送を招かないよう、処理側のエラーでも200を返す
    // (再送されても egressId 不一致チェックで冪等に無視されるだけではあるが、
    //  不要な再送ループを避けるため明示的に200で応答する)。
  }
  res.sendStatus(200);
});

/**
 * LiveKitのEgressStatus(数値のenum)を人間が読める文字列に変換する。
 * https://github.com/livekit/protocol/blob/main/protobufs/livekit_egress.proto
 * を参照。SDKバージョンによっては`egressInfo.status`が既に文字列で
 * 届く場合もあるため、その場合はそのまま返す。
 */
const EGRESS_STATUS_NAMES = [
  'EGRESS_STARTING',
  'EGRESS_ACTIVE',
  'EGRESS_ENDING',
  'EGRESS_COMPLETE',
  'EGRESS_FAILED',
  'EGRESS_ABORTED',
  'EGRESS_LIMIT_REACHED',
];

function describeEgressStatus(status) {
  if (typeof status === 'string') return status;
  return EGRESS_STATUS_NAMES[status] ?? `UNKNOWN(${status})`;
}

/**
 * egress_endedイベントの処理本体。
 * Firestore上のrecording.egressIdと一致する場合のみ状態を確定させる。
 * (古いegressの遅延イベントで、既に開始された新しい録音の状態を
 *  誤って消してしまわないようにするためのガード)
 */
async function handleEgressEnded(egressInfo) {
  const roomId = egressInfo?.roomName;
  if (!roomId) return;

  const roomRef = db.collection('rooms').doc(roomId);
  const snap = await roomRef.get();
  if (!snap.exists) return;

  const room = snap.data();
  if (!room.recording || room.recording.egressId !== egressInfo.egressId) {
    // 既に別の録音が始まっている、またはFirestore側が先に別経路でクリアされている
    return;
  }

  const statusName = describeEgressStatus(egressInfo.status);

  // [Phase8] 録音履歴(一覧・ダウンロードAPI用)をサブコレクションへ書き残す。
  // このドキュメントの書き込みに失敗しても、以降の recording:null 更新・
  // メタデータ同期は継続する(履歴の記録漏れよりも、録音状態フラグの
  // 確定を優先する)。
  try {
    await roomRef.collection('recordings').doc(egressInfo.egressId).set({
      egressId: egressInfo.egressId,
      filepath: room.recording.filepath || null,
      startedAt: room.recording.startedAt,
      endedAt: new Date(),
      status: statusName,
      startedByUid: room.recording.startedByUid || null,
    });
  } catch (e) {
    console.warn(`[録音履歴保存失敗] room=${roomId} egressId=${egressInfo.egressId}: ${e.message}`);
  }

  await roomRef.update({ recording: null });
  await syncRoomMetadata(roomId);

  console.log(
    `[録音終了] room=${roomId} egressId=${egressInfo.egressId} status=${statusName}`
  );

  // EGRESS_FAILED(4) の場合、egressInfo.errorに失敗理由の文字列が
  // 入っていることが多い。原因調査のため必ずログへ出す。
  if (statusName === 'EGRESS_FAILED' || statusName === 'EGRESS_ABORTED') {
    console.error(
      `[録音失敗詳細] room=${roomId} egressId=${egressInfo.egressId} error=${egressInfo.error || '(詳細情報なし)'}`
    );
  }
}

module.exports = router;
