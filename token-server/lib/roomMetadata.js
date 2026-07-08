/**
 * LiveKit Room Metadataへの書き込みを一箇所に集約するモジュール。
 *
 * [背景] talk.js(発話ロック) と recording.js(録音状態) はどちらも同じ
 * ルームのMetadata(単一のJSON文字列)に自分の状態を反映したいが、
 * updateRoomMetadata()は文字列を丸ごと上書きするAPIのため、各ルートが
 * バラバラに「自分のフィールドだけ」書くと、もう片方のフィールドを
 * 消してしまうレースが発生する。
 *
 * Firestoreのrooms/{roomId}を正とし、talkLockとrecordingの両方を
 * 読み出してから合成したJSONを一度にLiveKitへ書き込む、この関数を
 * 必ず経由させる。
 *
 * [使い方] talkLock取得/延長/解放・recording開始/終了のいずれの後でも、
 * 「引数なしでroomIdだけ渡して呼ぶ」ことでFirestoreの最新状態を
 * 読み直してから同期する。呼び出し側で現在の状態を組み立てる必要はない。
 */

const { RoomServiceClient } = require('livekit-server-sdk');
const { db } = require('./firebaseAdmin');

const roomService = new RoomServiceClient(
  process.env.LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

/**
 * Firestoreの rooms/{roomId} を読み、talkLock・recording の現在状態を
 * 合成したJSONをLiveKitのRoom Metadataへ書き込む。
 *
 * ルームがまだLiveKit側に存在しない(誰も接続していない)場合は
 * updateRoomMetadataがエラーになりうるが、その場合は「今は誰も見ていない」
 * ので無視してよい(warnログのみ)。
 */
async function syncRoomMetadata(roomId) {
  try {
    const snap = await db.collection('rooms').doc(roomId).get();
    if (!snap.exists) return;
    const room = snap.data();
    const at = Date.now();

    const currentTalker =
      room.talkLock && room.talkLock.expiresAt.toMillis() > at ? room.talkLock.uid : null;

    // egressIdなど内部情報は開示せず、全参加者への同意表示に必要な
    // active/startedAtだけをmetadataに載せる。
    const recording = room.recording && room.recording.active
      ? { active: true, startedAt: room.recording.startedAt?.toMillis?.() ?? null }
      : { active: false };

    await roomService.updateRoomMetadata(
      roomId,
      JSON.stringify({ currentTalker, recording, updatedAt: at })
    );
  } catch (e) {
    console.warn(`[roomMetadata] 同期スキップ room=${roomId}: ${e.message}`);
  }
}

module.exports = { syncRoomMetadata };
