import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, authedFetch } from '@/lib/api'
import type { AdminRoomDetail, AdminRoomListResponse, AdminRoomSummary } from '@/types/admin'

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
    fetchRooms,
    goToNextPage,
    goToFirstPage,
    refreshCurrentPage,
    fetchRoomDetail,
    clearDetail,
    setAutoRecording,
    setMemberRole,
  }
})
