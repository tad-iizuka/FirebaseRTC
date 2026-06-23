/**
 * PTT Server - Phase A Step 2: Opus mixing
 *
 * [修正・デバッグ用]
 * iOSから送られてきたOpusフレームが、サーバー側のopusscriptデコーダで
 * 「エラーなく」デコードされているにも関わらず、実際には無音/不正な
 * PCMになっている可能性を確認するため、デコード直後のPCMの振幅(最大絶対値)を
 * クライアントごとに間引いてログ出力するようにした。
 * 原因特定後は不要になれば削除してよい。
 */

const { WebSocketServer, WebSocket } = require('ws');
const OpusScript = require('opusscript');

const PORT = process.env.PORT || 8080;

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_SIZE = 960; // 20ms @ 48kHz
const MIX_INTERVAL_MS = 20;
const STALE_FRAME_MS = 60;

const rooms = new Map();

// [修正・デバッグ用] クライアントごとの診断ログのスロットリング用
const lastDiagLogAt = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Map(),
      mixTimer: null,
      sharedEncoder: new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP),
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

function broadcastBinary(roomState, buffer, excludeClientId = null) {
  for (const [clientId, client] of roomState.clients.entries()) {
    if (excludeClientId && clientId === excludeClientId) continue;
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(buffer);
  }
}

// [修正・デバッグ用] Int16Array PCMの最大絶対値を求める（無音/不正データの検出用）
function maxAbsAmplitude(int16arr) {
  let maxAbs = 0;
  for (let i = 0; i < int16arr.length; i++) {
    const v = Math.abs(int16arr[i]);
    if (v > maxAbs) maxAbs = v;
  }
  return maxAbs;
}

// [修正・デバッグ用] 1クライアントにつき1秒に1回程度の頻度で診断ログを出す
function logDiagThrottled(clientId, message) {
  const now = Date.now();
  const last = lastDiagLogAt.get(clientId) || 0;
  if (now - last > 1000) {
    lastDiagLogAt.set(clientId, now);
    console.log(`[diag] clientId=${clientId} ${message}`);
  }
}

// [FIX #1] opusscript の decode() は Int16Array を返す。
// 旧実装では Buffer メソッド(readInt16LE)で読もうとしていたため NaN が加算され音声が壊れていた。
// → Int16Array のインデックスで直接アクセスし、encode用に Buffer へ変換して返す。
function mixPcmBuffers(pcmBuffers) {
  const out = new Int16Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    let sum = 0;
    for (const buf of pcmBuffers) sum += buf[i];
    if (sum > 32767) sum = 32767;
    if (sum < -32768) sum = -32768;
    out[i] = sum;
  }
  return Buffer.from(out.buffer);
}

function startMixLoopIfNeeded(roomState, roomId) {
  if (roomState.mixTimer) return;

  roomState.mixTimer = setInterval(() => {
    const now = Date.now();

    // アクティブな送話者リストを収集（clientId も保持）
    const activeSenders = [];
    for (const [clientId, client] of roomState.clients.entries()) {
      if (client.lastPcm && now - client.lastFrameAt <= STALE_FRAME_MS) {
        activeSenders.push({ clientId, pcm: client.lastPcm });
      }
    }

    if (activeSenders.length === 0) return;

    if (activeSenders.length === 1) {
      // 送話者が1人の場合: 自分以外に送る
      const { clientId, pcm } = activeSenders[0];

      // [FIX #2] Int16Array → Buffer へ変換してからエンコード
      const pcmBuf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      let encoded;
      try {
        encoded = roomState.sharedEncoder.encode(pcmBuf, FRAME_SIZE);
      } catch (e) {
        console.error(`[room=${roomId}] encode error:`, e.message);
        return;
      }
      // [FIX #3] 送話者自身を除外して送信（エコー防止）
      broadcastBinary(roomState, encoded, clientId);

    } else {
      // 送話者が複数の場合: 各受信者ごとに「自分以外の音だけミックス」して送る
      for (const [receiverId, receiverClient] of roomState.clients.entries()) {
        if (receiverClient.ws.readyState !== WebSocket.OPEN) continue;

        const pcmsForReceiver = activeSenders
          .filter(s => s.clientId !== receiverId)
          .map(s => s.pcm);

        if (pcmsForReceiver.length === 0) continue;

        const mixedPcm = pcmsForReceiver.length === 1
          ? Buffer.from(pcmsForReceiver[0].buffer, pcmsForReceiver[0].byteOffset, pcmsForReceiver[0].byteLength)
          : mixPcmBuffers(pcmsForReceiver);

        let encoded;
        try {
          encoded = roomState.sharedEncoder.encode(mixedPcm, FRAME_SIZE);
        } catch (e) {
          console.error(`[room=${roomId}] encode error:`, e.message);
          continue;
        }
        receiverClient.ws.send(encoded);
      }
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

      let pcm;
      try {
        // opusscript decode() は Int16Array を返す
        pcm = client.decoder.decode(data);
      } catch (e) {
        console.error(`[decode error] room=${roomId} clientId=${clientId}:`, e.message);
        return;
      }

      // [修正・デバッグ用] 受信バイト数とデコード後の最大振幅をログに出す。
      // 「decodeは成功しているが内容が無音/不正データになっていないか」を確認するため。
      const maxAmp = maxAbsAmplitude(pcm);
      logDiagThrottled(clientId, `recv bytes=${data.length} decodedSamples=${pcm.length} maxAmp=${maxAmp}`);

      client.lastPcm = pcm; // Int16Array のまま保持
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

        roomState.clients.set(clientId, {
          ws,
          decoder: new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP),
          lastPcm: null,
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

      case 'leave': {
        removeFromRoom(ws);
        break;
      }

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
        if (client) {
          client.lastFrameAt = 0;
          client.lastPcm = null;
        }
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
