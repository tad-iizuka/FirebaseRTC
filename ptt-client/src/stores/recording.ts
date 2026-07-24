import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch } from '@/lib/api'
import type { RecordingStartResponse, RecordingStopResponse } from '@/types/api'

// [録音の開始/停止]
// 実際に「録音中である」状態(active/startedAt)は Room Metadata 経由で
// connection store が保持している(全参加者へのリアルタイム開示のため)。
// このstoreは owner/moderator が叩く /recording/start・/recording/stop の
// リクエスト自体と、そのエラー表示だけを担当する。
//
// [重要] /recording/start のレスポンスが返った時点ではまだ録音は開始されておらず、
// /recording/stop も「停止を依頼した」だけ(token-server/routes/recording.js参照)。
// 実際に録音中かどうかの確定状態は必ず connection store の isRecording を見ること。
// このstoreの pending/starting/stopping はあくまで「リクエストを送信中かどうか」の
// ローディング表示用。

export const useRecordingStore = defineStore('recording', () => {
  const starting = ref(false)
  const stopping = ref(false)
  const errorMessage = ref<string | null>(null)

  async function startRecording(baseUrl: string, roomId: string) {
    errorMessage.value = null
    starting.value = true
    try {
      await authedFetch<RecordingStartResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/recording/start`,
        { method: 'POST' },
      )
      // 開始の確定通知(recording.active: true)はRoom Metadata経由で
      // connection storeへ非同期に届く。ここでは楽観的に状態を変えない。
    } catch (e) {
      errorMessage.value = (e as Error).message
      throw e
    } finally {
      starting.value = false
    }
  }

  async function stopRecording(baseUrl: string, roomId: string) {
    errorMessage.value = null
    stopping.value = true
    try {
      await authedFetch<RecordingStopResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/recording/stop`,
        { method: 'POST' },
      )
      // これも「停止を依頼した」だけ。active:falseへの確定はegress_endedの
      // Webhook経由でRoom Metadataが更新されてから connection store に反映される。
    } catch (e) {
      errorMessage.value = (e as Error).message
      throw e
    } finally {
      stopping.value = false
    }
  }

  return { starting, stopping, errorMessage, startRecording, stopRecording }
})
