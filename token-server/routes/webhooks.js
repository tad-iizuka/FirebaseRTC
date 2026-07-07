/**
 * LiveKit Webhook受信API (Phase 4: 可観測性・運用)
 *
 * LiveKit CloudからPOSTされる room_started / room_finished / participant_joined /
 * participant_left / track_published / track_unpublished 等のイベントを受信し、
 *   1) Cloud Runの標準出力へ構造化ログ(JSON)として出す
 *      → Cloud Loggingでの検索や、ログベースの指標(急増検知アラート)の起点にする
 *   2) Firestoreの `events` コレクションに永続化する
 *      → 後からの利用状況の集計・調査用の生データとして残す
 * の二本立てで記録する。
 *
 * [重要] LiveKitのWebhookは、ペイロードをLIVEKIT_API_SECRETで署名したJWTを
 * Authorizationヘッダーに載せてくる。この署名検証(WebhookReceiver.receive)には
 * 「express.json()でパース済みのオブジェクト」ではなく「受信した生のリクエストボディ」が
 * 必要なため、このルートだけは server.js 側で express.raw() を使って生ボディのまま
 * 渡している(グローバルな express.json() より前にマウントする必要がある)。
 *
 * [セットアップ]
 * LiveKit Cloud > Project Settings > Webhooks で、このエンドポイントの絶対URLを
 * 登録する (例: https://ptt-token-server-xxxx.run.app/webhooks/livekit)。
 * 追加のAPIキー等は不要(既存の LIVEKIT_API_KEY / LIVEKIT_API_SECRET を流用する)。
 */

const express = require('express');
const { WebhookReceiver } = require('livekit-server-sdk');
const { db } = require('../lib/firebaseAdmin');

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
    // server.js側で express.raw() を通しているため req.body は Buffer/string のはず。
    // 万一 express.json() 等を経由してオブジェクト化されてしまっていた場合、署名検証は
    // 必ず失敗する(=設定ミスに早期に気付けるようにあえてフォールバックしない)。
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    event = await receiver.receive(rawBody, req.get('Authorization'));
  } catch (e) {
    console.warn('[Webhook検証エラー]', e.message);
    return res.status(401).json({ error: 'Webhook署名の検証に失敗しました' });
  }

  // Cloud Loggingでの検索・ログベース指標(異常な急増検知等)を想定した構造化ログ。
  // textPayload/jsonPayloadどちらでも検索できるよう、まず1行のJSONとして出しておく。
  console.log(JSON.stringify({
    tag: 'livekit_webhook',
    event: event.event,
    room: event.room?.name ?? null,
    roomSid: event.room?.sid ?? null,
    participant: event.participant?.identity ?? null,
    track: event.track?.sid ?? null,
    createdAt: new Date().toISOString(),
  }));

  // Firestoreへの永続化はベストエフォート。
  // LiveKit側は2xx以外の応答をリトライしてくる仕様のため、集計用DBへの書き込みが
  // 一時的に失敗しても、Webhook自体の受信(=200応答)は妨げないようにする。
  try {
    await db.collection('events').add({
      type: event.event,
      roomName: event.room?.name ?? null,
      roomSid: event.room?.sid ?? null,
      participantIdentity: event.participant?.identity ?? null,
      trackSid: event.track?.sid ?? null,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error('[Webhookイベント保存エラー]', e.message);
  }

  res.sendStatus(200);
});

module.exports = router;
