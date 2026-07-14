import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch } from '@/lib/api'
import type { DownloadUrlResponse, RecordingEntry, RecordingListResponse } from '@/types/admin'

// [Phase8] GET /rooms/:roomId/recordings, GET .../download-url のラッパーstore。
// [設計方針] これらは /admin/... 配下ではなく /rooms/:roomId/recordings 配下の
// エンドポイント(token-server/routes/recording.js)であり、「メンバーなら誰でも
// 閲覧可・owner/moderatorのみダウンロード可」という adminUsers の権限モデル
// (rooms:monitor等)とは別物のため、adminRoomsストアとは分離して持たせる。

export const useAdminRecordingsStore = defineStore('adminRecordings', () => {
  const recordings = ref<RecordingEntry[]>([])
  const isLoading = ref(false)
  const errorMessage = ref<string | null>(null)

  async function fetchRecordings(baseUrl: string, roomId: string) {
    isLoading.value = true
    errorMessage.value = null
    try {
      const data = await authedFetch<RecordingListResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/recordings`,
      )
      recordings.value = data.recordings
    } catch (e) {
      errorMessage.value = (e as Error).message
      recordings.value = []
    } finally {
      isLoading.value = false
    }
  }

  async function issueDownloadUrl(baseUrl: string, roomId: string, recordingId: string): Promise<string> {
    const data = await authedFetch<DownloadUrlResponse>(
      baseUrl,
      `/rooms/${encodeURIComponent(roomId)}/recordings/${encodeURIComponent(recordingId)}/download-url`,
    )
    return data.url
  }

  function clear() {
    recordings.value = []
    errorMessage.value = null
  }

  return { recordings, isLoading, errorMessage, fetchRecordings, issueDownloadUrl, clear }
})
