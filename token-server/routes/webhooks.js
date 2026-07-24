/**
 * LiveKit Webhook受信
 *
 * [設計方針]
 * routes/recording.js の /stop は「停止を依頼する」だけであり、実際に
 * Egressが終了した(成功/失敗いずれも含む)ことはLiveKitからの非同期
 * Webhookでしか確実に検知できない。そのため、Firestore上の
 * recording.active を false に確定させる処理はこのファイルに一本化する。
 *
 * egress_ended に加えて room_started・participant_joined も処理する。
 * room_finished 等、他のイベントを今後扱う場合もこのファイルに
 * 追加していく想定。
 *
 * [Phase9で追加: 自動録音]
 * rooms/{roomId}.settings.autoRecording が true の場合、録音を自動開始する。
 * 「誰かの発話を検知してから録音開始」だとPTT特有のEgress起動レイテンシ問題
 * (頭切れ)を踏むため、ルームがアクティブになった最も早いタイミングで
 * 開始しておく設計にしている(詳細はrecording.js冒頭のコメント参照)。
 *
 * [重要] トリガーには room_started だけでなく participant_joined も
 * 必要。room_started は「誰もいない状態から最初の1人が入室した瞬間」
 * にしか発火しない。「1人目が入室した後にautoRecordingをONにし、
 * その後2人目が入室する」というよくある運用では room_started は
 * 発火せず(参加者2人目以降は participant_joined のみ)、これが無いと
 * 録音が始まらなかった。両イベントとも同じ handleAutoRecordingTrigger を
 * 呼び、既に録音中なら startRecordingInternal 側の冪等性(Firestore
 * トランザクション)で二重起動を防いでいる。
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
const { startRecordingInternal, stopRecordingInternal } = require('./recording');

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
    } else if (event.event === 'room_started' || event.event === 'participant_joined') {
      await handleAutoRecordingTrigger(event.room);
    } else if (event.event === 'participant_left') {
      await handleAutoRecordingStopTrigger(event.room);
    } else if (event.event === 'room_finished') {
      // 空室検知(participant_left)を取りこぼした場合の保険。
      // room_finished時点ではroomはLiveKit側で既にクローズしているため
      // numParticipantsでの判定はせず、録音中なら無条件で停止する。
      await handleAutoRecordingStopTrigger(event.room, { force: true });
    }
    // 他のイベント種別は現状無視する。
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
      trigger: room.recording.trigger || 'manual', // 'manual' | 'auto'
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

/**
 * room_started / participant_joined イベント共通の処理本体。
 *
 * rooms/{roomId}.settings.autoRecording が true の場合のみ、ここで
 * 録音を自動開始する(routes/rooms.js の PATCH /:roomId/settings で
 * on/offを切り替え可能)。
 *
 * - room_started: ルームに最初の参加者が入室し、LiveKit側でルームが
 *   実体化した瞬間に届く(空室→非空室の遷移でのみ発火)。
 * - participant_joined: 2人目以降も含め、誰かが入室するたびに届く。
 *   「1人目入室後にautoRecordingをONにし、その後2人目が入室する」
 *   ケースをカバーするために必要(room_startedだけでは拾えない)。
 *
 * 既に録音中(手動開始・別イベント経由の自動開始と競合した等)の場合は
 * startRecordingInternal が黙って null を返すので、ここでもエラー扱いに
 * しない(冪等)。参加者が入室するたびに毎回呼ばれる想定のため、この
 * 冪等性がないと入室者数だけEgressが起動してしまう。
 *
 * この処理が失敗してもWebhookエンドポイント自体は200を返す
 * (LiveKit側の不要な再送ループを避けるため。egress_ended同様の方針)。
 */
async function handleAutoRecordingTrigger(roomInfo) {
  const roomId = roomInfo?.name;
  if (!roomId) return;

  const roomRef = db.collection('rooms').doc(roomId);
  const snap = await roomRef.get();
  if (!snap.exists) return;

  const room = snap.data();
  if (!room.settings?.autoRecording) return;
  if (room.recording && room.recording.active) return; // 既に録音中なら何もしない(無駄なFirestoreトランザクションを避ける)

  try {
    const result = await startRecordingInternal(roomId, {
      startedByUid: room.ownerUid || null,
      trigger: 'auto',
    });
    if (result) {
      console.log(`[自動録音開始] room=${roomId} egressId=${result.egressId}`);
    }
    // result が null = 既に録音中 → 何もせず正常終了(冪等)
  } catch (e) {
    console.error(`[自動録音開始エラー] room=${roomId}: ${e.message}`);
  }
}

/**
 * participant_left / room_finished イベント共通の処理本体。
 *
 * ルームが空室になった時点で、進行中の録音(手動/自動を問わず)を停止する。
 * 空室のまま録音を続けても意味がないため、trigger種別による分岐はしない。
 *
 * - participant_left: event.room.numParticipantsは「退室者を除いた後の
 *   人数」としてLiveKitから届く。これが0になった時点で空室と判定する。
 * - room_finished: ルーム自体がクローズした後に届くため、numParticipants
 *   の値を信用せず(force=true)、録音中なら無条件で停止する。
 *   participant_leftの取りこぼし(Webhook配送順序の乱れ・欠落等)に対する
 *   保険として位置づける。
 *
 * 実際の停止確定(recording:nullへの更新・録音履歴の書き込み)は
 * handleEgressEnded側で行う。ここではEgressの停止を「依頼」するのみ
 * (routes/recording.js の /stop と同じ立て付け)。
 *
 * この処理が失敗してもWebhookエンドポイント自体は200を返す
 * (egress_ended/handleAutoRecordingTrigger同様の方針)。
 */
async function handleAutoRecordingStopTrigger(roomInfo, { force = false } = {}) {
  const roomId = roomInfo?.name;
  if (!roomId) return;

  if (!force && roomInfo?.numParticipants !== 0) return;

  try {
    // 録音中かどうかの判定・冪等性はstopRecordingInternal側に委譲する
    // (手動停止APIと同じ関数を使うため、ここでFirestoreを二重に読まない)。
    const result = await stopRecordingInternal(roomId, { actorUid: null });
    if (result) {
      console.log(`[空室検知による録音停止依頼] room=${roomId} egressId=${result.egressId}`);
    }
    // 実際のrecording:nullへの更新とrecordings履歴への書き込みは
    // これに続くegress_endedイベントで行われる。
  } catch (e) {
    if (e && e.httpStatus === 404) return; // ルームが既に削除されている等
    console.error(`[空室検知による録音停止エラー] room=${roomId}: ${e.message}`);
  }
}

module.exports = router;
