import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, authedFetch } from '@/lib/api'
import type {
  AdminCreateRoomResponse,
  AdminRoomDetail,
  AdminRoomListResponse,
  AdminRoomSummary,
} from '@/types/admin'

// [設計方針]
// token-server/routes/admin.js は Firestore(台帳) と LiveKit(ライブな実接続状況) の
// 両方を突き合わせて返す。このstoreはそれをそのまま保持するだけで、
// 突き合わせ自体はサーバー側の責務(admin.js参照)。
//
// 403(権限なし)は「エラーで落ちた」ではなく「そもそもこの機能が使えない」状態として
// 区別して表示できるよう、isForbidden フラグを分けて持たせる。

export const useAdminRoomsStore = defineStore('adminRooms', () => {
  const rooms = ref<AdminRoomSummary[]>([])
  const nextCursor = ref<string | null>(null)
  const cursorHistory = ref<(string | null)[]>([]) // 「前のページ」に戻るための履歴
  // [Phase8] 表示中のページを識別するカーソル。ポーリングでの再取得時に
  // ページングを崩さず「今見ているページ」だけを再フェッチするために使う。
  const currentCursor = ref<string | null>(null)

  const detail = ref<AdminRoomDetail | null>(null)

  const isLoadingList = ref(false)
  const isLoadingDetail = ref(false)
  const errorMessage = ref<string | null>(null)
  const isForbidden = ref(false)

  function resetError() {
    errorMessage.value = null
    isForbidden.value = false
  }

  async function fetchRooms(baseUrl: string, cursor: string | null = null) {
    isLoadingList.value = true
    resetError()
    try {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      const data = await authedFetch<AdminRoomListResponse>(baseUrl, `/admin/rooms${qs}`)
      rooms.value = data.rooms
      nextCursor.value = data.nextCursor
      currentCursor.value = cursor
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isForbidden.value = true
      } else {
        errorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoadingList.value = false
    }
  }

  async function goToNextPage(baseUrl: string) {
    if (!nextCursor.value) return
    cursorHistory.value.push(nextCursor.value)
    await fetchRooms(baseUrl, nextCursor.value)
  }

  async function goToFirstPage(baseUrl: string) {
    cursorHistory.value = []
    await fetchRooms(baseUrl, null)
  }

  /** [Phase8] ポーリング用: ページングを崩さず現在表示中のページだけを再取得する。 */
  async function refreshCurrentPage(baseUrl: string) {
    await fetchRooms(baseUrl, currentCursor.value)
  }

  async function fetchRoomDetail(baseUrl: string, roomId: string) {
    isLoadingDetail.value = true
    // [Phase8] ポーリングによる再取得時に画面がちらつかないよう、既に同じ
    // ルームの詳細を表示中であれば detail を null に戻さず裏で更新する。
    // 別ルームへ遷移した場合(roomIdが変わった場合)のみリセットする。
    if (!detail.value || detail.value.roomId !== roomId) {
      detail.value = null
    }
    resetError()
    try {
      detail.value = await authedFetch<AdminRoomDetail>(baseUrl, `/admin/rooms/${encodeURIComponent(roomId)}`)
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isForbidden.value = true
      } else {
        errorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoadingDetail.value = false
    }
  }

  function clearDetail() {
    detail.value = null
    clearInviteCode()
  }

  // --- [ルーム作成のadmin-dashboard移管] ---
  // 以前はptt-client(POST /rooms)からユーザー自身がルームを作成できたが、
  // 今後は admin-dashboard専用の POST /admin/rooms(rooms:create権限)に
  // 一本化する。招待コードは作成時のレスポンスでのみ返却され、以降どの
  // APIからも再取得できないため(brushup-plan.md 5.4参照)、直近で作成した
  // ルームの情報を lastCreatedRoom に保持し、UI側で作成直後に必ず表示・
  // コピーできるようにする(ルーム一覧へ戻ると消える想定。clearLastCreated参照)。
  const isCreatingRoom = ref(false)
  const createRoomErrorMessage = ref<string | null>(null)
  const lastCreatedRoom = ref<AdminCreateRoomResponse | null>(null)

  async function createRoom(baseUrl: string, name: string, maxMembers?: number) {
    isCreatingRoom.value = true
    createRoomErrorMessage.value = null
    try {
      const room = await authedFetch<AdminCreateRoomResponse>(baseUrl, '/admin/rooms', {
        method: 'POST',
        body: { name, maxMembers: maxMembers ?? undefined },
      })
      lastCreatedRoom.value = room
      // 一覧の先頭に反映しておくと、作成後すぐに一覧を見ても表示される
      // (次のポーリング/再読み込みで正規のAdminRoomSummaryへ置き換わる)。
      rooms.value = [
        {
          roomId: room.roomId,
          name: room.name,
          ownerUid: room.ownerUid,
          createdAt: room.createdAt,
          maxMembers: room.maxMembers,
          activeMemberCount: null,
          orgId: null,
          nodeId: null,
          nodeAncestorIds: [],
          talkLock: null,
          recording: { active: false, startedAt: null },
          live: { isLive: false, numParticipants: 0 },
          schedule: room.schedule,
        },
        ...rooms.value,
      ]
      return room
    } catch (e) {
      createRoomErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isCreatingRoom.value = false
    }
  }

  function clearLastCreatedRoom() {
    lastCreatedRoom.value = null
  }

  // [ルーム名] PATCH /admin/rooms/:roomId/name (rooms:manage権限)。
  // 楽観的更新+失敗時ロールバックは他の設定系操作(setAutoRecording等)と同じ方針。
  const isUpdatingName = ref(false)
  const nameErrorMessage = ref<string | null>(null)

  async function updateRoomName(baseUrl: string, roomId: string, name: string) {
    if (!detail.value || detail.value.roomId !== roomId) return
    const before = detail.value.name
    detail.value.name = name
    isUpdatingName.value = true
    nameErrorMessage.value = null
    try {
      const result = await authedFetch<{ roomId: string; name: string | null }>(
        baseUrl,
        `/admin/rooms/${encodeURIComponent(roomId)}/name`,
        { method: 'PATCH', body: { name } },
      )
      if (detail.value && detail.value.roomId === roomId) {
        detail.value.name = result.name
      }
      // 一覧側に同じRoomが読み込まれていれば、こちらも合わせて更新する。
      rooms.value = rooms.value.map((r) => (r.roomId === roomId ? { ...r, name: result.name } : r))
    } catch (e) {
      if (detail.value && detail.value.roomId === roomId) {
        detail.value.name = before
      }
      nameErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isUpdatingName.value = false
    }
  }

  // [設定] room/:roomId/settings/autoRecording (Firestore) のON/OFF切り替え。
  // token-server側に PATCH /admin/rooms/:roomId/settings/autoRecording の実装が必要
  // (body: { enabled: boolean })。楽観的にUIを更新し、失敗時は元の値へ戻す。
  const isUpdatingAutoRecording = ref(false)

  async function setAutoRecording(baseUrl: string, roomId: string, enabled: boolean) {
    if (!detail.value || detail.value.roomId !== roomId) return
    const before = detail.value.settings.autoRecording
    detail.value.settings.autoRecording = enabled
    isUpdatingAutoRecording.value = true
    errorMessage.value = null
    try {
      await authedFetch<void>(baseUrl, `/admin/rooms/${encodeURIComponent(roomId)}/settings/autoRecording`, {
        method: 'PATCH',
        body: { enabled },
      })
    } catch (e) {
      if (detail.value && detail.value.roomId === roomId) {
        detail.value.settings.autoRecording = before
      }
      errorMessage.value = (e as Error).message
      throw e
    } finally {
      isUpdatingAutoRecording.value = false
    }
  }

  // [Phase12] admin-dashboardからのmoderator任命/降格。
  // token-server/routes/rooms.js側の同名API(Room内ownerのみ実行可能)とは別に、
  // PATCH /admin/rooms/:roomId/members/:targetUid/role(rooms:manage権限)を叩く。
  // 同時に複数メンバーのroleを更新できるよう、更新中のuidをSetで管理する
  // (autoRecordingトグルと違い対象が複数行あるため、単一のbooleanでは表現できない)。
  const updatingRoleUids = ref<Set<string>>(new Set())
  const roleErrorMessage = ref<string | null>(null)

  async function setMemberRole(
    baseUrl: string,
    roomId: string,
    targetUid: string,
    role: 'moderator' | 'member',
  ) {
    if (!detail.value || detail.value.roomId !== roomId) return
    const member = detail.value.members.find((m) => m.uid === targetUid)
    const before = member?.role
    roleErrorMessage.value = null
    updatingRoleUids.value = new Set(updatingRoleUids.value).add(targetUid)
    // 楽観的更新: 成功する前提でUIを即座に反映し、失敗時のみ元に戻す
    if (member) member.role = role
    try {
      await authedFetch<void>(
        baseUrl,
        `/admin/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(targetUid)}/role`,
        { method: 'PATCH', body: { role } },
      )
    } catch (e) {
      if (member && before) member.role = before
      roleErrorMessage.value = (e as Error).message
      throw e
    } finally {
      const next = new Set(updatingRoleUids.value)
      next.delete(targetUid)
      updatingRoleUids.value = next
    }
  }

  // [開始/終了時刻] PATCH /admin/rooms/:roomId/schedule (rooms:manage権限)。
  // updateRoomNameと同じ楽観的更新+失敗時ロールバック方針。
  // start/endはUI側からミリ秒(number)またはnullで渡す想定
  // (Date型はJSONへ直列化できないため、ここでは扱わない)。
  const isUpdatingSchedule = ref(false)
  const scheduleErrorMessage = ref<string | null>(null)

  async function updateSchedule(
    baseUrl: string,
    roomId: string,
    schedule: { start: number | null; end: number | null },
  ) {
    if (!detail.value || detail.value.roomId !== roomId) return
    const before = detail.value.schedule
    detail.value.schedule = schedule
    isUpdatingSchedule.value = true
    scheduleErrorMessage.value = null
    try {
      const result = await authedFetch<{ roomId: string; schedule: { start: number | null; end: number | null } }>(
        baseUrl,
        `/admin/rooms/${encodeURIComponent(roomId)}/schedule`,
        { method: 'PATCH', body: schedule },
      )
      if (detail.value && detail.value.roomId === roomId) {
        detail.value.schedule = result.schedule
      }
      rooms.value = rooms.value.map((r) => (r.roomId === roomId ? { ...r, schedule: result.schedule } : r))
    } catch (e) {
      if (detail.value && detail.value.roomId === roomId) {
        detail.value.schedule = before
      }
      scheduleErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isUpdatingSchedule.value = false
    }
  }

  // --- [招待コードのadmin-dashboard移管] ---
  // GET /admin/rooms/:roomId/invite-code(rooms:manage権限)。招待コードの
  // 閲覧は監査ログに記録されるため(token-server/routes/admin.js参照)、
  // GET /admin/rooms/:roomId のポーリング(usePolling)には含めず、ユーザーが
  // 「表示」ボタンを押した時だけ明示的に呼び出す(issueDownloadUrlと同じ設計)。
  // ルーム切り替え時は clearInviteCode で必ずリセットし、前のRoomの値が
  // 誤って別Roomの画面に残らないようにする。
  const inviteCode = ref<string | null>(null)
  const isRevealingInviteCode = ref(false)
  const inviteCodeErrorMessage = ref<string | null>(null)
  const inviteCodeForbidden = ref(false)

  async function revealInviteCode(baseUrl: string, roomId: string) {
    isRevealingInviteCode.value = true
    inviteCodeErrorMessage.value = null
    inviteCodeForbidden.value = false
    try {
      const data = await authedFetch<{ inviteCode: string | null }>(
        baseUrl,
        `/admin/rooms/${encodeURIComponent(roomId)}/invite-code`,
      )
      inviteCode.value = data.inviteCode
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        inviteCodeForbidden.value = true
      } else {
        inviteCodeErrorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isRevealingInviteCode.value = false
    }
  }

  function clearInviteCode() {
    inviteCode.value = null
    inviteCodeErrorMessage.value = null
    inviteCodeForbidden.value = false
  }

  return {
    rooms,
    nextCursor,
    currentCursor,
    detail,
    isLoadingList,
    isLoadingDetail,
    errorMessage,
    isForbidden,
    isUpdatingAutoRecording,
    updatingRoleUids,
    roleErrorMessage,
    isCreatingRoom,
    createRoomErrorMessage,
    lastCreatedRoom,
    isUpdatingName,
    nameErrorMessage,
    isUpdatingSchedule,
    scheduleErrorMessage,
    updateSchedule,
    inviteCode,
    isRevealingInviteCode,
    inviteCodeErrorMessage,
    inviteCodeForbidden,
    fetchRooms,
    goToNextPage,
    goToFirstPage,
    refreshCurrentPage,
    fetchRoomDetail,
    clearDetail,
    setAutoRecording,
    setMemberRole,
    createRoom,
    clearLastCreatedRoom,
    updateRoomName,
    revealInviteCode,
    clearInviteCode,
  }
})
