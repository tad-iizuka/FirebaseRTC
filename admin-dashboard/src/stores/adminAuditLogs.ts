import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, authedFetch } from '@/lib/api'
import type { AuditLogEntry, AuditLogListResponse } from '@/types/admin'

// [Phase8] GET /admin/audit-logs のラッパーstore。
// adminRoomsストアと同じ「403は isForbidden、それ以外は errorMessage」の
// 区別方針を踏襲する。roomId/actorUidでの絞り込みはサーバー側で複合インデックスが
// 必要(token-server/firestore.indexes.json参照)。

export const useAdminAuditLogsStore = defineStore('adminAuditLogs', () => {
  const logs = ref<AuditLogEntry[]>([])
  const nextCursor = ref<string | null>(null)
  const roomIdFilter = ref('')
  const actorUidFilter = ref('')

  const isLoading = ref(false)
  const errorMessage = ref<string | null>(null)
  const isForbidden = ref(false)

  function resetError() {
    errorMessage.value = null
    isForbidden.value = false
  }

  function buildQuery(cursor: string | null): string {
    const params = new URLSearchParams()
    if (roomIdFilter.value.trim()) params.set('roomId', roomIdFilter.value.trim())
    if (actorUidFilter.value.trim()) params.set('actorUid', actorUidFilter.value.trim())
    if (cursor) params.set('cursor', cursor)
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }

  async function fetchLogs(baseUrl: string, cursor: string | null = null) {
    isLoading.value = true
    resetError()
    try {
      const data = await authedFetch<AuditLogListResponse>(baseUrl, `/admin/audit-logs${buildQuery(cursor)}`)
      logs.value = data.logs
      nextCursor.value = data.nextCursor
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isForbidden.value = true
      } else {
        errorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoading.value = false
    }
  }

  /** フィルタ入力欄の内容を反映して1ページ目から取得し直す。 */
  async function applyFilters(baseUrl: string) {
    await fetchLogs(baseUrl, null)
  }

  async function goToNextPage(baseUrl: string) {
    if (!nextCursor.value) return
    await fetchLogs(baseUrl, nextCursor.value)
  }

  return {
    logs,
    nextCursor,
    roomIdFilter,
    actorUidFilter,
    isLoading,
    errorMessage,
    isForbidden,
    fetchLogs,
    applyFilters,
    goToNextPage,
  }
})
