/**
 * lib/roomSchedule.js
 *
 * [背景] rooms/{roomId}.schedule (start/end) による時間軸の制約を、
 * token.js・talk.js・messages.js・rooms.jsの複数箇所で同じロジックで
 * 判定する必要があるため、lib/permissions.js(role×操作の対応表)と同じ
 * 考え方でここに一本化する。
 *
 * [role×操作との関係]
 * 「room内roleで何ができるか」(lib/permissions.js)と「今が開始前/実施中/
 * 終了後のどれか」(このモジュール)は意図的に別軸として扱う。例えば
 * chat:send は role不問(ROOM_ROLES)だが、in_session以外では時間軸側の
 * ゲートで一律拒否する、という形で両方が独立にAND条件として効く。
 *
 * [無期限の表現]
 * 「無期限」は真偽値のフラグを持たず、schedule.end が未設定(null)である
 * ことで表現する(brushup-planでの合意)。schedule.start も同様に未設定なら
 * 「即入室可」を意味する。
 *
 * [3状態]
 *   - before_start: schedule.start が未来。入室(membersドキュメント作成)
 *     自体はできるが、送話・チャット送受信ともに不可(待機画面のみ)
 *   - in_session: 通常状態。全ての操作が(role×操作の対応表に従って)可能
 *   - after_end: schedule.end を過ぎている。新規入室は可能だが、
 *     できることはチャット閲覧のみ(送話・チャット送信は不可)
 */

const { RoomServiceClient } = require('livekit-server-sdk');
const { db } = require('./firebaseAdmin');
const { syncRoomMetadata } = require('./roomMetadata');

const roomService = new RoomServiceClient(
  process.env.LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

/**
 * schedule( { start?: Timestamp|null, end?: Timestamp|null } )と現在時刻から
 * 状態を判定する。scheduleフィールド自体が未設定(旧仕様のルーム)の場合は
 * 無期限・即入室可のRoomとして扱う(in_session)。
 */
function resolveScheduleState(schedule, atMs = Date.now()) {
  if (!schedule) return 'in_session';
  if (schedule.start && schedule.start.toMillis() > atMs) return 'before_start';
  if (schedule.end && schedule.end.toMillis() <= atMs) return 'after_end';
  return 'in_session';
}

/**
 * 入力値(ミリ秒 or ISO文字列 or null/undefined)を検証し、Firestoreへ
 * そのまま書き込める形(Date or null)に正規化する。
 * @returns {{ error: string } | { value: { start: Date|null, end: Date|null } }}
 */
function normalizeSchedule({ start, end } = {}) {
  const toDateOrNull = (raw) => {
    if (raw === undefined || raw === null || raw === '') return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return undefined; // 不正値の目印
    return d;
  };

  const startDate = toDateOrNull(start);
  const endDate = toDateOrNull(end);
  if (startDate === undefined || endDate === undefined) {
    return { error: 'start / end は日時として解釈できる値を指定してください' };
  }
  if (startDate && endDate && startDate.getTime() >= endDate.getTime()) {
    return { error: 'end は start より後の時刻を指定してください' };
  }
  return { value: { start: startDate, end: endDate } };
}

/**
 * 終了時刻を過ぎたRoomを実際に「閉じる」処理。
 *   1. アクティブなmembersを全員LiveKitから物理的に切断する(BANキックと
 *      同じ roomService.removeParticipant を使う。deleteRoom で
 *      ルーム自体を消してしまうと、after_end でも「入室してチャット閲覧のみ
 *      可能」という要件と整合しなくなるため使わない)。
 *   2. rooms/{roomId}.schedule.expiredAt に処理済みの印を書き込む
 *      (sweep処理が同じRoomを何度も処理しないための冪等性の担保)。
 *   3. syncRoomMetadata で接続の残っているクライアントへも状態を伝える。
 *
 * 呼び出し元は2箇所:
 *   - 管理者がスケジュールを変更し、その場で「もう終了時刻を過ぎている」
 *     状態になった場合(routes/admin.js、同期的に呼ぶ)
 *   - sweep(routes/internal.js)が定期的に検知した場合
 */
async function expireRoom(roomId) {
  const roomRef = db.collection('rooms').doc(roomId);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) return;
  const room = roomSnap.data();

  if (room.schedule?.expiredAt) return; // 既に処理済み(冪等)

  const membersSnap = await roomRef.collection('members').where('status', '==', 'active').get();
  await Promise.all(
    membersSnap.docs.map(async (doc) => {
      try {
        await roomService.removeParticipant(roomId, doc.id);
      } catch (e) {
        // 対象が現在未接続ならLiveKit側がエラーを返すが、致命的ではない
        // (routes/rooms.js の BAN キックと同じ扱い)。
        console.warn(`[roomSchedule] 強制退出キック失敗(未接続の可能性) room=${roomId} uid=${doc.id}: ${e.message}`);
      }
    })
  );

  await roomRef.update({ 'schedule.expiredAt': new Date() });
  syncRoomMetadata(roomId);
  console.log(`[roomSchedule] Room終了処理 room=${roomId} members=${membersSnap.size}`);
}

/**
 * Expressミドルウェア。requireRoomMembership の後段で使う想定
 * (req.roomMember だけでなく room ドキュメントも必要なため、
 * 内部でFirestoreへもう一度アクセスする)。
 *
 * in_session でなければ403。token.js(LiveKit接続そのもの)・talk.js
 * (送話ロック)・messages.js(チャット送信)の3箇所で共通して使う。
 */
function requireInSession(req, res, next) {
  const { roomId } = req.params;
  db.collection('rooms')
    .doc(roomId)
    .get()
    .then((snap) => {
      if (!snap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }
      const state = resolveScheduleState(snap.data().schedule);
      if (state !== 'in_session') {
        return res.status(403).json({
          error:
            state === 'before_start'
              ? 'このルームはまだ開始時刻前です'
              : 'このルームは終了時刻を過ぎています(チャット閲覧のみ可能です)',
          code: state,
        });
      }
      req.roomScheduleState = state;
      next();
    })
    .catch((e) => {
      console.error('[roomSchedule] スケジュール確認エラー', e.message);
      res.status(500).json({ error: 'スケジュールの確認に失敗しました' });
    });
}

/**
 * Expressミドルウェア。requireRoomMembership の後段で使う想定。
 *
 * チャットの「閲覧」系操作(添付ファイルの読み取りURL発行等)向け。
 * 送信・送話とは異なり after_end でも許可する(「終了時刻以降はチャット
 * 閲覧のみ可能」の要件)必要があるため、before_start のみを拒否する
 * (requireInSessionはafter_endも拒否するため、閲覧系には強すぎる)。
 */
function requireNotBeforeStart(req, res, next) {
  const { roomId } = req.params;
  db.collection('rooms')
    .doc(roomId)
    .get()
    .then((snap) => {
      if (!snap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }
      const state = resolveScheduleState(snap.data().schedule);
      if (state === 'before_start') {
        return res.status(403).json({ error: 'このルームはまだ開始時刻前です', code: state });
      }
      req.roomScheduleState = state;
      next();
    })
    .catch((e) => {
      console.error('[roomSchedule] スケジュール確認エラー', e.message);
      res.status(500).json({ error: 'スケジュールの確認に失敗しました' });
    });
}

module.exports = {
  resolveScheduleState,
  normalizeSchedule,
  expireRoom,
  requireInSession,
  requireNotBeforeStart,
};
