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

  async function fetchRoomDetail(baseUrl: string, roomId: string) {
    isLoadingDetail.value = true
    detail.value = null
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

  return {
    rooms,
    nextCursor,
    detail,
    isLoadingList,
    isLoadingDetail,
    errorMessage,
    isForbidden,
    fetchRooms,
    goToNextPage,
    goToFirstPage,
    fetchRoomDetail,
    clearDetail,
  }
})
