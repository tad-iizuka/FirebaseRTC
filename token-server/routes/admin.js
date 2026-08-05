/**
 * 管理者向け: 複数ルーム横断監視API (Phase 5) + 監査ログ・権限管理API (Phase 8)
 *
 * [設計方針]
 * 「ルームの状態」には2種類の情報源があり、性質が異なる:
 *   1. Firestore (rooms/{roomId}, members) … 誰がメンバーか・BAN状態・
 *      発話ロック・録音状態など「永続化された台帳」
 *   2. LiveKit (RoomServiceClient) … 実際に今、誰が物理的に接続しているか
 *      という「ライブな実態」
 * 例えば「メンバーではあるが今は繋いでいない人」「BANされたが接続自体は
 * 即時キックでもう切れている人」等、両者は一致しない。管理者が見たいのは
 * 主にライブな実態(今何人繋いでいるか)なので、両方を突き合わせて返す。
 *
 * [パフォーマンス上の注意]
 * ルーム一覧APIでは LiveKit の listRooms() を「1回だけ」呼び、
 * ルームごとに listRooms を叩くN+1を避けている。
 * 一方、Firestore側のアクティブメンバー数は count() 集計クエリを
 * ルームごとに呼んでいるため、ページサイズ(最大 MAX_PAGE_SIZE)で
 * 読み取りコストの上限を切っている。
 *
 * [Phase8で追加]
 *   - GET /admin/audit-logs … lib/auditLog.js が記録した操作履歴の閲覧。
 *     roomId/actorUidでの絞り込みは Firestore複合インデックスが必要
 *     (firestore.indexes.json / phase8-operations.md 参照)。
 *   - GET /admin/admins, POST /admin/admins/:uid/permissions …
 *     adminUsers(権限台帳)の閲覧・編集。ただし admins:manage 自体の
 *     付与/剥奪はこのAPIでは行えない(dev-tools/grant-admin-permission.js
 *     での手動運用に固定。自己昇格・権限エスカレーションを防ぐため)。
 *
 * [Phase11で追加]
 *   - GET /admin/rooms のルーム一覧に orgId/nodeId/nodeAncestorIds(生ID)を
 *     追加。名前解決はしない(一覧でのN+1読み取りを避けるため)。
 *   - GET /admin/rooms/:roomId のルーム詳細に、lib/orgContext.js で
 *     名前解決済みの org: {orgId, orgName, breadcrumb} を追加
 *     (routes/rooms.js の GET /:roomId/org-context と同じ計算ロジックを
 *     共有。権限判定の方法だけが異なる)。
 *   - 組織階層自体のCRUD・Roomへの割り当ては routes/organizations.js
 *     (/admin/organizations*, PATCH /admin/rooms/:roomId/org-assignment)。
 *
 * [ルーム作成のadmin-dashboard移管で追加]
 *   - rooms/{roomId} に name(表示名, 未設定はnull)フィールドを追加。
 *     GET /admin/rooms・GET /admin/rooms/:roomId のレスポンスにも含める。
 *   - POST /admin/rooms(rooms:create権限): admin-dashboardからのルーム
 *     新規作成。呼び出した管理者がownerになる。routes/rooms.jsの
 *     `POST /rooms`(rooms:create権限必須へ変更)と処理を共有する
 *     (lib/roomCreation.js)。
 *   - PATCH /admin/rooms/:roomId/name(rooms:manage権限): ルーム名の変更。
 */

const express = require('express');
const { RoomServiceClient } = require('livekit-server-sdk');
const { admin, db } = require('../lib/firebaseAdmin');
const { logAdminAction } = require('../lib/auditLog');
const { resolveOrgContext } = require('../lib/orgContext');
const { requireFirebaseAuth, isValidRoomId } = require('../middleware/requireAuth');
const { requireAdminPermission } = require('../middleware/requireAdmin');
const { checkRoleAssignmentTarget } = require('../lib/permissions');
const { resolveMaxMembers, createRoomAndOwnerMember, normalizeRoomName } = require('../lib/roomCreation');
const { normalizeSchedule, resolveScheduleState, expireRoom } = require('../lib/roomSchedule');
const { syncRoomMetadata } = require('../lib/roomMetadata');

const router = express.Router();

const roomService = new RoomServiceClient(
  process.env.LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// [開始/終了時刻] Firestoreの Timestamp|null をレスポンス用のミリ秒|nullへ
// 変換する。room.scheduleフィールド自体が無い(本機能追加前に作成された
// 既存Room)場合も { start: null, end: null } として返す。
function serializeSchedule(room) {
  return {
    start: room.schedule?.start?.toMillis?.() ?? null,
    end: room.schedule?.end?.toMillis?.() ?? null,
  };
}

/**
 * GET /admin/rooms?limit=50&cursor=<roomId>
 *
 * 全ルームを作成日時降順で一覧表示する。ページングはcursor(直前ページ
 * 最後のroomId)方式。
 */
router.get('/rooms', requireFirebaseAuth, requireAdminPermission('rooms:monitor'), async (req, res) => {
  const pageSize = Math.min(
    Number.parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

  try {
    let query = db.collection('rooms').orderBy('createdAt', 'desc').limit(pageSize);
    if (cursor) {
      const cursorSnap = await db.collection('rooms').doc(cursor).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }
    const snap = await query.get();

    // LiveKit側の「今まさに誰か接続しているルーム」一覧を1回だけ取得し、
    // roomId(=LiveKitのroom name)でつき合わせる。
    let liveRoomsByName = new Map();
    try {
      const liveRooms = await roomService.listRooms();
      liveRoomsByName = new Map(liveRooms.map((r) => [r.name, r]));
    } catch (e) {
      console.warn('[管理者ダッシュボード] LiveKit listRooms失敗(Firestore情報のみで応答継続):', e.message);
    }

    const now = Date.now();

    const rooms = await Promise.all(
      snap.docs.map(async (doc) => {
        const room = doc.data();
        const roomId = doc.id;

        let activeMemberCount = null;
        try {
          const countSnap = await db
            .collection('rooms')
            .doc(roomId)
            .collection('members')
            .where('status', '==', 'active')
            .count()
            .get();
          activeMemberCount = countSnap.data().count;
        } catch (e) {
          console.warn(`[管理者ダッシュボード] memberCount取得失敗 room=${roomId}: ${e.message}`);
        }

        const live = liveRoomsByName.get(roomId);

        return {
          roomId,
          name: room.name ?? null,
          ownerUid: room.ownerUid,
          createdAt: room.createdAt?.toMillis?.() ?? null,
          maxMembers: room.maxMembers ?? null,
          activeMemberCount,
          // [Phase11] 一覧では名前解決(団体名・node名)まではせず、IDのみ返す。
          // 名前が必要な画面は別途 GET /admin/organizations 等で取得した
          // 一覧と突き合わせるか、詳細画面(GET /admin/rooms/:roomId)で
          // 解決済みのbreadcrumbを取得する。一覧で毎行breadcrumbを解決すると
          // N+1読み取りになるため、ここでは意図的に生IDのみに留めている。
          orgId: room.orgId ?? null,
          nodeId: room.nodeId ?? null,
          nodeAncestorIds: room.nodeAncestorIds ?? [],
          talkLock:
            room.talkLock && room.talkLock.expiresAt.toMillis() > now
              ? { uid: room.talkLock.uid, expiresAt: room.talkLock.expiresAt.toMillis() }
              : null,
          recording:
            room.recording && room.recording.active
              ? { active: true, startedAt: room.recording.startedAt?.toMillis?.() ?? null }
              : { active: false },
          live: {
            isLive: !!live,
            numParticipants: live ? Number(live.numParticipants) : 0,
          },
          schedule: serializeSchedule(room),
        };
      })
    );

    res.json({
      rooms,
      nextCursor: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null,
    });
  } catch (e) {
    console.error('[管理者ダッシュボード: ルーム一覧エラー]', e.message);
    res.status(500).json({ error: 'ルーム一覧の取得に失敗しました' });
  }
});

/**
 * GET /admin/rooms/:roomId
 *
 * 1ルームの詳細: メンバー台帳(Firestore) + 実際の接続状況(LiveKit)。
 */
router.get('/rooms/:roomId', requireFirebaseAuth, requireAdminPermission('rooms:monitor'), async (req, res) => {
  const { roomId } = req.params;
  if (!isValidRoomId(roomId)) {
    return res.status(400).json({ error: 'roomId が不正です' });
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return res.status(404).json({ error: 'ルームが見つかりません' });
    }
    const room = roomSnap.data();

    const membersSnap = await roomRef.collection('members').get();
    const members = membersSnap.docs.map((d) => {
      const m = d.data();
      return {
        uid: d.id,
        role: m.role,
        displayName: m.displayName,
        status: m.status,
        joinedAt: m.joinedAt?.toMillis?.() ?? null,
        bannedAt: m.bannedAt?.toMillis?.() ?? null,
      };
    });

    // ルームに現在誰も接続していない場合、LiveKit側はNotFoundを返しうる。
    // これは異常ではない(単に「今は誰もいない」)ので、空配列にフォールバックする。
    let liveParticipants = [];
    try {
      const participants = await roomService.listParticipants(roomId);
      liveParticipants = participants.map((p) => ({
        identity: p.identity,
        joinedAt: p.joinedAt ? Number(p.joinedAt) * 1000 : null,
        isPublishingAudio: (p.tracks || []).some((t) => t.type === 'AUDIO' && !t.muted),
      }));
    } catch (e) {
      console.warn(`[管理者ダッシュボード] listParticipants失敗(未接続の可能性) room=${roomId}: ${e.message}`);
    }

    const now = Date.now();
    const org = await resolveOrgContext(room); // [Phase11]

    res.json({
      roomId,
      name: room.name ?? null,
      ownerUid: room.ownerUid,
      createdAt: room.createdAt?.toMillis?.() ?? null,
      maxMembers: room.maxMembers ?? null,
      members,
      org, // [Phase11] { orgId, orgName, breadcrumb } または全てnull/空配列(無所属)
      talkLock:
        room.talkLock && room.talkLock.expiresAt.toMillis() > now
          ? {
              uid: room.talkLock.uid,
              acquiredAt: room.talkLock.acquiredAt?.toMillis?.() ?? null,
              expiresAt: room.talkLock.expiresAt.toMillis(),
            }
          : null,
      recording:
        room.recording && room.recording.active
          ? {
              active: true,
              startedAt: room.recording.startedAt?.toMillis?.() ?? null,
              startedByUid: room.recording.startedByUid ?? null,
            }
          : { active: false },
      liveParticipants,
      // [Phase9] routes/rooms.js の PATCH /rooms/:roomId/settings と同じ
      // rooms/{roomId}.settings.autoRecording を参照する。
      settings: { autoRecording: !!room.settings?.autoRecording },
      // [開始/終了時刻] PATCH /admin/rooms/:roomId/schedule で変更する。
      schedule: serializeSchedule(room),
    });
  } catch (e) {
    console.error('[管理者ダッシュボード: ルーム詳細エラー]', e.message);
    res.status(500).json({ error: 'ルーム詳細の取得に失敗しました' });
  }
});

/**
 * GET /admin/rooms/:roomId/invite-code
 *
 * [招待コードのadmin-dashboard移管]
 * 招待コードは以前POST /rooms(またはPOST /admin/rooms)作成時の
 * レスポンスでしか返却されず、以降どのAPIからも再取得できなかった
 * (brushup-plan.md 5.4「招待コードの可視範囲」)。この課題を解消するため
 * 常時確認できるようにするが、以下2点をあわせて満たす設計とした。
 *
 * (1) 権限: GET /admin/rooms/:roomId(rooms:monitor)とは別に、より強い
 *     rooms:manage 権限(名称変更・moderator任命等と同じ「管理」層)を
 *     要求する。rooms:monitor保有者全員に「Roomへの参加権を事実上配布
 *     できる」権限まで広げないため。
 * (2) 監査ログ: 招待コードの閲覧自体をlogAdminActionへ記録する。
 *     GET /admin/rooms/:roomId はRoomDetailView.vueから10秒間隔で
 *     ポーリングされているため、そちらに招待コードを含めてしまうと
 *     画面を開いているだけで大量の閲覧ログが記録されてしまう。
 *     そのため招待コードは専用のこのエンドポイントに切り出し、
 *     admin-dashboard側は「表示」ボタン押下時などユーザーの明示的な
 *     操作でのみ呼び出す(GET .../download-urlと同じ「明示的な操作の
 *     たびに発行・記録する」設計を踏襲)。
 */
router.get(
  '/rooms/:roomId/invite-code',
  requireFirebaseAuth,
  requireAdminPermission('rooms:manage'),
  async (req, res) => {
    const { roomId } = req.params;
    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }

    try {
      const roomRef = db.collection('rooms').doc(roomId);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }
      const room = roomSnap.data();

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: 'room:invite_code_viewed',
        targetRoomId: roomId,
      });

      res.json({ inviteCode: room.inviteCode ?? null });
    } catch (e) {
      console.error('[招待コード閲覧エラー]', e.message);
      res.status(500).json({ error: '招待コードの取得に失敗しました' });
    }
  }
);

/**
 * POST /admin/rooms
 * body: { name: string, maxMembers?: number }
 *
 * [ルーム作成のadmin-dashboard移管]
 * ルーム作成をadmin-dashboard専用の経路に一本化する。以前ptt-client等の
 * クライアントから叩いていた `POST /rooms`(routes/rooms.js)は
 * `rooms:create`権限必須へ変更した上で残しているが、今後の正規の作成経路は
 * こちら。呼び出した管理者自身がownerになる(`POST /rooms`時代と同じ、
 * 呼び出しユーザーがownerになるという設計を踏襲。admin-dashboard側で
 * 別途owner変更手段は用意していない)。
 *
 * 招待コードは作成時のこのレスポンスでのみ返却され、以降どのAPIからも
 * 再取得できない(brushup-plan.md 5.4「招待コードの可視範囲」で洗い出した
 * 既存の制約と同じ)。admin-dashboard側は作成直後に必ず表示・コピーできる
 * UIにする必要がある(RoomsListView.vue参照)。
 *
 * 共通の作成処理は lib/roomCreation.js に集約している
 * (routes/rooms.js の `POST /rooms` と重複させないため)。
 */
router.post('/rooms', requireFirebaseAuth, requireAdminPermission('rooms:create'), async (req, res) => {
  const uid = req.firebaseUser.uid;
  const name = req.body?.name;

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name は必須です' });
  }

  const maxMembersResult = resolveMaxMembers(req.body?.maxMembers);
  if ('error' in maxMembersResult) {
    return res.status(400).json({ error: maxMembersResult.error });
  }

  try {
    // [開始/終了時刻] body: { schedule?: { start?: string|number|null, end?: string|number|null } }
    // 未指定なら無期限・即入室可(lib/roomSchedule.js#normalizeSchedule参照)。
    const created = await createRoomAndOwnerMember({
      ownerUid: uid,
      ownerDisplayName: req.firebaseUser.name || req.firebaseUser.email || uid,
      name,
      maxMembers: maxMembersResult.value,
      schedule: req.body?.schedule,
    });
    if ('error' in created) {
      return res.status(400).json({ error: created.error });
    }

    await logAdminAction({
      actorUid: uid,
      action: 'room:create',
      targetRoomId: created.roomId,
      detail: { name: created.name, maxMembers: created.maxMembers, schedule: created.schedule, via: 'admin_dashboard' },
    });

    console.log(`[管理者ダッシュボード: ルーム作成] roomId=${created.roomId} name=${created.name} owner=${uid}`);
    res.status(201).json({
      roomId: created.roomId,
      name: created.name,
      inviteCode: created.inviteCode,
      ownerUid: uid,
      createdAt: created.createdAt.getTime(),
      maxMembers: created.maxMembers,
      schedule: {
        start: created.schedule.start ? created.schedule.start.getTime() : null,
        end: created.schedule.end ? created.schedule.end.getTime() : null,
      },
    });
  } catch (e) {
    console.error('[管理者ダッシュボード: ルーム作成エラー]', e.message);
    res.status(500).json({ error: 'ルームの作成に失敗しました' });
  }
});

/**
 * PATCH /admin/rooms/:roomId/name
 * body: { name: string }
 *
 * ルーム名を変更する。空文字を送ると未設定(null)に戻せる
 * (lib/roomCreation.js の normalizeRoomName が空文字/空白のみをnullへ
 * 正規化するため)。rooms:manage権限(PATCH .../settings/autoRecordingや
 * moderator任命APIと同じ権限)を要求する。
 */
router.patch(
  '/rooms/:roomId/name',
  requireFirebaseAuth,
  requireAdminPermission('rooms:manage'),
  async (req, res) => {
    const { roomId } = req.params;

    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }
    if (typeof req.body?.name !== 'string') {
      return res.status(400).json({ error: 'name は必須です(未設定に戻す場合は空文字を指定してください)' });
    }

    const name = normalizeRoomName(req.body.name);

    try {
      const roomRef = db.collection('rooms').doc(roomId);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }

      await roomRef.update({ name });

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: 'room:name_update',
        targetRoomId: roomId,
        detail: { name },
      });

      console.log(`[管理者ダッシュボード: ルーム名変更] roomId=${roomId} name=${name} by=${req.firebaseUser.uid}`);
      res.json({ roomId, name });
    } catch (e) {
      console.error('[管理者ダッシュボード: ルーム名変更エラー]', e.message);
      res.status(500).json({ error: 'ルーム名の変更に失敗しました' });
    }
  }
);

/**
 * PATCH /admin/rooms/:roomId/settings/autoRecording
 * body: { enabled: boolean }
 *
 * [Phase9で追加] 管理ダッシュボードのルーム詳細画面から自動録音設定を
 * ON/OFFする。routes/rooms.js の PATCH /rooms/:roomId/settings は
 * 「そのルームのowner/moderatorであること」を要求するが、管理者は
 * 監視対象ルームのメンバーとは限らないため、ここでは代わりに
 * rooms:manage 権限(adminUsers台帳)で許可する。書き込み先は同じ
 * rooms/{roomId}.settings.autoRecording であり、routes/webhooks.js の
 * handleAutoRecordingTrigger からの参照はどちらの経路で更新されても
 * 変わらず機能する。
 *
 * [注意] falseにしても、その時点で既に進行中の録音は止まらない
 * (routes/rooms.js側の同名エンドポイントと同じ設計)。
 */
router.patch(
  '/rooms/:roomId/settings/autoRecording',
  requireFirebaseAuth,
  requireAdminPermission('rooms:manage'),
  async (req, res) => {
    const { roomId } = req.params;

    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled はboolean型で指定してください' });
    }

    try {
      const roomRef = db.collection('rooms').doc(roomId);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }

      await roomRef.update({ 'settings.autoRecording': req.body.enabled });

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: 'room:settings_update',
        targetRoomId: roomId,
        detail: { autoRecording: req.body.enabled, via: 'admin_dashboard' },
      });

      console.log(
        `[管理者ダッシュボード: 設定更新] roomId=${roomId} autoRecording=${req.body.enabled} by=${req.firebaseUser.uid}`
      );
      res.json({ roomId, autoRecording: req.body.enabled });
    } catch (e) {
      console.error('[管理者ダッシュボード: 設定更新エラー]', e.message);
      res.status(500).json({ error: '設定の更新に失敗しました' });
    }
  }
);

/**
 * PATCH /admin/rooms/:roomId/schedule
 * body: { start?: string|number|null, end?: string|number|null }
 *
 * [開始/終了時刻] 開始・終了時刻の設定・変更はサイト管理者(rooms:manage)
 * のみに許可する(brushup-planでの決定。Room内owner向けの経路は用意しない)。
 * start/end とも未指定または null で「即入室可/無期限」に戻せる。
 *
 * [即時反映] Room内role同様、変更を接続中クライアントへ即座に伝えたいため、
 * 保存直後に syncRoomMetadata を呼ぶ(talk.js/recording.jsと同じパターン)。
 * さらに、変更の結果「新しいendが既に過去」になった場合(＝今すぐ終了させたい
 * ケース)は、sweep処理(routes/internal.js)の次回実行を待たず、この場で
 * 同期的に lib/roomSchedule.js#expireRoom を呼んで強制退出まで完了させる。
 */
router.patch(
  '/rooms/:roomId/schedule',
  requireFirebaseAuth,
  requireAdminPermission('rooms:manage'),
  async (req, res) => {
    const { roomId } = req.params;

    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }

    const scheduleResult = normalizeSchedule(req.body || {});
    if ('error' in scheduleResult) {
      return res.status(400).json({ error: scheduleResult.error });
    }

    try {
      const roomRef = db.collection('rooms').doc(roomId);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) {
        return res.status(404).json({ error: 'ルームが見つかりません' });
      }

      // expiredAt(sweepの冪等性の印)は毎回リセットする。延長によって
      // in_sessionへ戻った後、再度endを過ぎたら改めて強制退出処理が
      // 必要になるため。
      await roomRef.update({
        schedule: { start: scheduleResult.value.start, end: scheduleResult.value.end },
      });

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: 'room:schedule_update',
        targetRoomId: roomId,
        detail: {
          start: scheduleResult.value.start ? scheduleResult.value.start.getTime() : null,
          end: scheduleResult.value.end ? scheduleResult.value.end.getTime() : null,
        },
      });

      syncRoomMetadata(roomId);

      const newState = resolveScheduleState({
        start: scheduleResult.value.start ? admin.firestore.Timestamp.fromDate(scheduleResult.value.start) : null,
        end: scheduleResult.value.end ? admin.firestore.Timestamp.fromDate(scheduleResult.value.end) : null,
      });
      if (newState === 'after_end') {
        await expireRoom(roomId); // ポーリングを待たず即時に強制退出させる
      }

      console.log(`[管理者ダッシュボード: スケジュール更新] roomId=${roomId} by=${req.firebaseUser.uid} state=${newState}`);
      res.json({
        roomId,
        schedule: {
          start: scheduleResult.value.start ? scheduleResult.value.start.getTime() : null,
          end: scheduleResult.value.end ? scheduleResult.value.end.getTime() : null,
        },
        scheduleState: newState,
      });
    } catch (e) {
      console.error('[管理者ダッシュボード: スケジュール更新エラー]', e.message);
      res.status(500).json({ error: 'スケジュールの更新に失敗しました' });
    }
  }
);

/**
 * PATCH /admin/rooms/:roomId/members/:targetUid/role
 * body: { role: "moderator" | "member" }
 *
 * [Phase12で追加]
 * routes/rooms.js の POST /:roomId/members/:targetUid/role(Room内ownerのみ
 * 実行可能)とは別経路で、admin-dashboardからmoderatorの任命/降格を
 * 行えるようにする。routes/rooms.jsのmoderator任命APIは実装されて以降
 * どのクライアントからも呼ばれておらず(Phase12棚卸しで判明)、
 * 「room内のownerが不在・連絡が取れない場合にサイト管理者が代行できる
 * 手段が無い」状態だったため追加した。
 *
 * [権限] PATCH /admin/rooms/:roomId/settings/autoRecording と同じ考え方で
 * rooms:manage を要求する(Room内roleとは別の、サイト管理者権限の軸)。
 *
 * [Room内owner専用APIとの整合性] 対象がownerの場合・guestの場合を拒否する
 * ガードは routes/rooms.js 側と同一の理由でこちらにも適用する
 * (owner降格による管理不能事故の防止、本人確認のない匿名認証由来の
 * guestをmoderatorに任命できる抜け道を塞ぐため)。
 * [Phase12] このガード自体は routes/rooms.js と重複実装されていたため、
 * lib/permissions.js の checkRoleAssignmentTarget に集約した
 * (phase12-role-operation-inventory.md 論点4)。
 */
router.patch(
  '/rooms/:roomId/members/:targetUid/role',
  requireFirebaseAuth,
  requireAdminPermission('rooms:manage'),
  async (req, res) => {
    const uid = req.firebaseUser.uid;
    const { roomId, targetUid } = req.params;
    const role = req.body?.role;

    if (!isValidRoomId(roomId)) {
      return res.status(400).json({ error: 'roomId が不正です' });
    }
    if (!['moderator', 'member'].includes(role)) {
      return res.status(400).json({ error: 'role は moderator または member を指定してください' });
    }

    try {
      const roomRef = db.collection('rooms').doc(roomId);
      const targetRef = roomRef.collection('members').doc(targetUid);
      const targetSnap = await targetRef.get();
      // [Phase12] owner降格禁止・BAN済み対象禁止・guest任命禁止のガードは
      // routes/rooms.js のRoom内owner専用APIと共通のため
      // lib/permissions.js の checkRoleAssignmentTarget に集約した。
      const targetGuardError = checkRoleAssignmentTarget(targetSnap.exists ? targetSnap.data() : null);
      if (targetGuardError) {
        return res.status(targetGuardError.status).json({ error: targetGuardError.error });
      }
      const targetData = targetSnap.data();

      await targetRef.update({ role });

      await logAdminAction({
        actorUid: uid,
        action: 'room:role_change',
        targetRoomId: roomId,
        targetUid,
        detail: { newRole: role, previousRole: targetData.role, via: 'admin_dashboard' },
      });

      console.log(
        `[管理者ダッシュボード: role変更] roomId=${roomId} target=${targetUid} role=${role} by=${uid}`
      );
      res.json({ roomId, targetUid, role });
    } catch (e) {
      console.error('[管理者ダッシュボード: role変更エラー]', e.message);
      res.status(500).json({ error: 'roleの変更に失敗しました' });
    }
  }
);

/**
 * GET /admin/audit-logs?roomId=&actorUid=&cursor=&limit=
 *
 * [設計方針] roomId / actorUid での絞り込みは Firestore の複合インデックスが
 * 必要になる(where(...) + orderBy(createdAt))。デプロイ前に
 * `firebase deploy --only firestore:indexes` でインデックスを作成しておくこと
 * (firestore.indexes.json / phase8-operations.md 参照)。両方同時に指定された
 * 場合はroomId側を優先する。
 */
router.get('/audit-logs', requireFirebaseAuth, requireAdminPermission('audit:read'), async (req, res) => {
  const pageSize = Math.min(Number.parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

  try {
    let query = db.collection('auditLogs').orderBy('createdAt', 'desc').limit(pageSize);
    if (req.query.roomId) {
      query = db
        .collection('auditLogs')
        .where('targetRoomId', '==', String(req.query.roomId))
        .orderBy('createdAt', 'desc')
        .limit(pageSize);
    } else if (req.query.actorUid) {
      query = db
        .collection('auditLogs')
        .where('actorUid', '==', String(req.query.actorUid))
        .orderBy('createdAt', 'desc')
        .limit(pageSize);
    }
    if (cursor) {
      const cursorSnap = await db.collection('auditLogs').doc(cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.get();
    const logs = snap.docs.map((d) => {
      const l = d.data();
      return {
        logId: d.id,
        actorUid: l.actorUid,
        action: l.action,
        targetRoomId: l.targetRoomId,
        targetUid: l.targetUid,
        detail: l.detail,
        createdAt: l.createdAt?.toMillis?.() ?? null,
      };
    });
    res.json({
      logs,
      nextCursor: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1].id : null,
    });
  } catch (e) {
    console.error('[監査ログ取得エラー]', e.message);
    res.status(500).json({ error: '監査ログの取得に失敗しました' });
  }
});

/**
 * GET /admin/me
 *
 * [2026-07-31 追加、item3(論点5)対応]
 * サインインしてさえいれば誰でも呼べる(特定の管理者権限を要求しない)。
 * 目的は「自分が何の権限を持っているか」をクライアント側が把握できるように
 * すること。admin-dashboard はこのレスポンスの permissions が空配列の場合、
 * NavTabs 自体を出さず汎用的な「権限がありません」画面を表示する
 * (adminUsers/{uid} が未作成の場合も同様に空配列として扱う)。
 *
 * 権限の中身(どの文字列がどの操作に対応するか)は返さない。あくまで
 * 「自分に付与されている権限の一覧」のみを返すため、これ自体が新たな
 * 権限体系の開示にはならない(付与されていない他人の権限体系は分からない)。
 *
 * [2026-08-01 追加、item5(組織ロースター層)対応]
 * managedOrgIds: 自分が orgRole: 'admin' として登録されている団体の
 * orgId一覧(scopeNodeIdsの有無・中身は含めない。「団体全体管理者」か
 * 「scope限定管理者」かの区別はUI側が個別に
 * `GET /admin/organizations/:orgId/members` を呼んで判別する)。
 * サイト全体のrootユーザー('organizations:manage'保持者)であっても、
 * 自分自身がorganizations/{orgId}/members に登録されていなければ
 * ここには含まれない(root権限自体は既存のpermissionsで表現されており、
 * managedOrgIdsは「明示的に名簿登録されている団体」だけを表すため)。
 * routes/organizations.js が名簿登録時に書き込む非正規化フィールド
 * `uid`(ドキュメントIDと同値)をcollectionGroupクエリの絞り込み条件に
 * 使う(lib/attachments.jsのexpiresAtと同じ考え方)。
 */
router.get('/me', requireFirebaseAuth, async (req, res) => {
  const uid = req.firebaseUser.uid;
  try {
    const doc = await db.collection('adminUsers').doc(uid).get();
    const permissions = doc.exists ? doc.data().permissions || [] : [];

    const membershipSnap = await db
      .collectionGroup('members')
      .where('uid', '==', uid)
      .where('orgRole', '==', 'admin')
      .get();
    const managedOrgIds = membershipSnap.docs.map((d) => d.ref.parent.parent.id);

    res.json({ uid, email: req.firebaseUser.email || null, permissions, managedOrgIds });
  } catch (e) {
    console.error('[GET /admin/me エラー]', e.message);
    res.status(500).json({ error: '取得に失敗しました' });
  }
});

/**
 * GET /admin/admins
 * adminUsers 全件一覧。admins:manage 権限が必要。
 */
router.get('/admins', requireFirebaseAuth, requireAdminPermission('admins:manage'), async (req, res) => {
  try {
    const snap = await db.collection('adminUsers').get();
    const admins = snap.docs.map((d) => ({
      uid: d.id,
      permissions: d.data().permissions || [],
      note: d.data().note || null,
      grantedAt: d.data().grantedAt?.toMillis?.() ?? null,
    }));
    res.json({ admins });
  } catch (e) {
    console.error('[管理者一覧取得エラー]', e.message);
    res.status(500).json({ error: '管理者一覧の取得に失敗しました' });
  }
});

/**
 * POST /admin/admins/:uid/permissions
 * body: { permission: string, action: "grant" | "revoke" }
 *
 * [注意] admins:manage 自体はこのAPIでは付与/剥奪できない
 * (dev-tools/grant-admin-permission.js の手動運用に固定。自己昇格・
 *  権限エスカレーションを防ぐため)。
 */
router.post(
  '/admins/:uid/permissions',
  requireFirebaseAuth,
  requireAdminPermission('admins:manage'),
  async (req, res) => {
    const targetUid = req.params.uid;
    const { permission, action } = req.body || {};

    if (typeof permission !== 'string' || !permission) {
      return res.status(400).json({ error: 'permission は必須です' });
    }
    if (!['grant', 'revoke'].includes(action)) {
      return res.status(400).json({ error: 'action は grant または revoke を指定してください' });
    }
    if (permission === 'admins:manage') {
      return res.status(403).json({
        error:
          'admins:manage の付与/剥奪はこのAPIでは行えません(dev-tools/grant-admin-permission.js を使用してください)',
      });
    }

    try {
      const ref = db.collection('adminUsers').doc(targetUid);
      if (action === 'grant') {
        await ref.set(
          { permissions: admin.firestore.FieldValue.arrayUnion(permission), grantedAt: new Date() },
          { merge: true }
        );
      } else {
        await ref.set(
          { permissions: admin.firestore.FieldValue.arrayRemove(permission) },
          { merge: true }
        );
      }

      await logAdminAction({
        actorUid: req.firebaseUser.uid,
        action: `admin:${action}`,
        targetUid,
        detail: { permission },
      });

      console.log(
        `[管理者権限${action === 'grant' ? '付与' : '剥奪'}] target=${targetUid} permission=${permission} by=${req.firebaseUser.uid}`
      );
      res.json({ uid: targetUid, permission, action });
    } catch (e) {
      console.error('[管理者権限変更エラー]', e.message);
      res.status(500).json({ error: '権限の変更に失敗しました' });
    }
  }
);

module.exports = router;
