/**
 * PTT Server - Phase A Step 2: Opus mixing
 *
 * [修正済み]
 * - [FIX #4→#7] opusscript 0.1.1 は decode() の第2引数(frameSize)を完全に無視するバグがあり、
 *   常に1920サンプル(40ms)でデコードされ maxAmp=255固定という不正な結果になっていた。
 *   opusscript は最新版でも0.1.1のまま更新が止まっているため、
 *   libopus ネイティブバインディングの @discordjs/opus に乗り換えた。
 *   @discordjs/opus の decode() は Buffer を返し、内部で正しく960サンプルをデコードする。
 * - [FIX #5] sharedEncoder を廃止し、クライアントごとに専用エンコーダを持つ方式に変更。
 * - [FIX #6] 1人/複数人送話の処理パスを受信者ごとエンコードに統一。
 *
 * 事前準備:
 *   npm uninstall opusscript
 *   npm install @discordjs/opus
 */

const { WebSocketServer, WebSocket } = require('ws');
const { OpusEncoder } = require('@discordjs/opus');

const PORT = process.env.PORT || 8080;

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_SIZE = 960; // 20ms @ 48kHz
const MIX_INTERVAL_MS = 20;
const STALE_FRAME_MS = 150;

const rooms = new Map();

const lastDiagLogAt = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Map(),
      mixTimer: null,
    });
  }
  return rooms.get(roomId);
}

function sendJSON(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcastJSON(roomState, payload, excludeClientId = null) {
  const data = JSON.stringify(payload);
  for (const [clientId, client] of roomState.clients.entries()) {
    if (clientId === excludeClientId) continue;
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(data);
  }
}

// [診断用] Int16 PCM Buffer の最大絶対値を求める
function maxAbsAmplitude(buf) {
  let maxAbs = 0;
  for (let i = 0; i < buf.length - 1; i += 2) {
    const v = Math.abs(buf.readInt16LE(i));
    if (v > maxAbs) maxAbs = v;
  }
  return maxAbs;
}

function logDiagThrottled(clientId, message) {
  const now = Date.now();
  const last = lastDiagLogAt.get(clientId) || 0;
  if (now - last > 1000) {
    lastDiagLogAt.set(clientId, now);
    console.log(`[diag] clientId=${clientId} ${message}`);
  }
}

// PCM は Int16LE の Buffer。複数バッファをサンプル単位でミックスして返す。
function mixPcmBuffers(pcmBuffers) {
  const out = Buffer.alloc(FRAME_SIZE * 2); // Int16 = 2バイト/サンプル
  for (let i = 0; i < FRAME_SIZE; i++) {
    let sum = 0;
    for (const buf of pcmBuffers) sum += buf.readInt16LE(i * 2);
    if (sum > 32767) sum = 32767;
    if (sum < -32768) sum = -32768;
    out.writeInt16LE(sum, i * 2);
  }
  return out;
}

function startMixLoopIfNeeded(roomState, roomId) {
  if (roomState.mixTimer) return;

  roomState.mixTimer = setInterval(() => {
    const now = Date.now();

    const activeSenders = [];
    for (const [clientId, client] of roomState.clients.entries()) {
      // キューから1フレーム取り出す
      if (client.pcmQueue.length > 0 && now - client.lastFrameAt <= STALE_FRAME_MS) {
        const pcm = client.pcmQueue.shift();
        activeSenders.push({ clientId, pcm });
      }
    }

    if (activeSenders.length === 0) return;

    // 受信者ごとに「自分以外の音をミックス → 受信者専用エンコーダでエンコード → 送信」
    for (const [receiverId, receiverClient] of roomState.clients.entries()) {
      if (receiverClient.ws.readyState !== WebSocket.OPEN) continue;

      const pcmsForReceiver = activeSenders
        .filter(s => s.clientId !== receiverId)
        .map(s => s.pcm);

      if (pcmsForReceiver.length === 0) continue;

      const mixedPcm = pcmsForReceiver.length === 1
        ? pcmsForReceiver[0]
        : mixPcmBuffers(pcmsForReceiver);

      let encoded;
      try {
        encoded = receiverClient.encoder.encode(mixedPcm);
      } catch (e) {
        console.error(`[room=${roomId}] encode error:`, e.message);
        continue;
      }
      receiverClient.ws.send(encoded);
    }
  }, MIX_INTERVAL_MS);
}

function stopMixLoopIfEmpty(roomState) {
  if (roomState.clients.size === 0 && roomState.mixTimer) {
    clearInterval(roomState.mixTimer);
    roomState.mixTimer = null;
  }
}

function removeFromRoom(ws) {
  const meta = ws.pttMeta;
  if (!meta) return;
  const { roomId, clientId } = meta;
  if (!rooms.has(roomId)) return;

  const roomState = rooms.get(roomId);
  roomState.clients.delete(clientId);

  console.log(`[leave] room=${roomId} clientId=${clientId} (remaining=${roomState.clients.size})`);
  broadcastJSON(roomState, { type: 'member_left', clientId });
  stopMixLoopIfEmpty(roomState);

  if (roomState.clients.size === 0) {
    rooms.delete(roomId);
    console.log(`[room destroyed] room=${roomId}`);
  }

  ws.pttMeta = null;
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.pttMeta = null;

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!ws.pttMeta) return;
      const { roomId, clientId } = ws.pttMeta;
      const roomState = rooms.get(roomId);
      if (!roomState) return;
      const client = roomState.clients.get(clientId);
      if (!client) return;

      // [FIX] ws ライブラリのバージョンによって data が Buffer / ArrayBuffer / Buffer[]
      // のいずれかで届く。@discordjs/opus の decode() は Buffer のみ受け付けるため
      // 型を明示的に正規化する。
      const frame = Buffer.isBuffer(data) ? data
        : Array.isArray(data)             ? Buffer.concat(data)
        :                                   Buffer.from(data);

      // [診断] 受信データの型・サイズを1秒スロットリングでログ出力
      logDiagThrottled(clientId + '_type', `recv type=${data.constructor.name} frameBytes=${frame.length}`);

      let pcm;
      try {
        // @discordjs/opus の decode() は Buffer(Int16LE PCM) を返す。
        // frameSize 指定不要で内部的に正しく960サンプル(=1920バイト)をデコードする。
        pcm = client.decoder.decode(frame);
      } catch (e) {
        console.error(`[decode error] room=${roomId} clientId=${clientId}:`, e.message);
        return;
      }

      const decodedSamples = pcm.length / 2; // Int16 = 2バイト/サンプル
      const maxAmp = maxAbsAmplitude(pcm);
      logDiagThrottled(clientId, `recv bytes=${data.length} decodedSamples=${decodedSamples} maxAmp=${maxAmp}`);

      // キューに積む。溜まりすぎ防止のため上限を設ける（約500ms分）
      if (client.pcmQueue.length < 25) {
        client.pcmQueue.push(pcm);
      }
      client.lastFrameAt = Date.now();
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      sendJSON(ws, { type: 'error', message: 'invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'join': {
        const { room: roomId, clientId } = msg;
        if (!roomId || !clientId) {
          sendJSON(ws, { type: 'error', message: 'room and clientId are required' });
          return;
        }

        const roomState = getOrCreateRoom(roomId);

        if (roomState.clients.has(clientId)) {
          sendJSON(ws, { type: 'error', message: `clientId "${clientId}" already in use in this room` });
          return;
        }

        // [FIX #7] @discordjs/opus の OpusEncoder はエンコード・デコード両方を担う。
        // クライアントごとに decoder/encoder を独立して持つ。
        roomState.clients.set(clientId, {
          ws,
          decoder: new OpusEncoder(SAMPLE_RATE, CHANNELS),
          encoder: new OpusEncoder(SAMPLE_RATE, CHANNELS),
          // [FIX] lastPcm(1フレームのみ保持)をキュー方式に変更。
          // iOSは100ms分(5フレーム)をバースト送信するため、キューで全フレームを保持し
          // ミックスループが20msごとに1フレームずつ消費する。
          pcmQueue: [],
          lastFrameAt: 0,
        });
        ws.pttMeta = { roomId, clientId };

        console.log(`[join] room=${roomId} clientId=${clientId} (total=${roomState.clients.size})`);

        sendJSON(ws, {
          type: 'joined',
          room: roomId,
          clientId,
          members: Array.from(roomState.clients.keys()),
          audioFormat: { sampleRate: SAMPLE_RATE, channels: CHANNELS, frameSize: FRAME_SIZE },
        });

        broadcastJSON(roomState, { type: 'member_joined', clientId }, clientId);
        startMixLoopIfNeeded(roomState, roomId);
        break;
      }

      case 'leave':
        removeFromRoom(ws);
        break;

      case 'ptt_start': {
        if (!ws.pttMeta) return;
        const { roomId, clientId } = ws.pttMeta;
        const roomState = rooms.get(roomId);
        if (!roomState) return;
        console.log(`[ptt_start] room=${roomId} clientId=${clientId}`);
        broadcastJSON(roomState, { type: 'talker_start', clientId }, clientId);
        break;
      }

      case 'ptt_end': {
        if (!ws.pttMeta) return;
        const { roomId, clientId } = ws.pttMeta;
        const roomState = rooms.get(roomId);
        if (!roomState) return;
        console.log(`[ptt_end] room=${roomId} clientId=${clientId}`);
        broadcastJSON(roomState, { type: 'talker_end', clientId }, clientId);
        const client = roomState.clients.get(clientId);
        if (client) { client.lastFrameAt = 0; client.pcmQueue = []; }
        break;
      }

      default:
        sendJSON(ws, { type: 'error', message: `unknown type: ${msg.type}` });
    }
  });

  ws.on('close', () => removeFromRoom(ws));
  ws.on('error', (err) => console.error('[ws error]', err.message));
});

console.log(`PTT server (Step2: Opus mixing) listening on ws://localhost:${PORT}`);
