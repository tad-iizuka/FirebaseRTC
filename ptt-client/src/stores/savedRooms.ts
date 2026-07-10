import { defineStore } from 'pinia'
import { ref } from 'vue'

// [設計方針]
// token-serverにはルーム一覧を返すAPIが無い(招待制のため「一覧」という概念が薄い)。
// そのため、あくまで「自分が過去に作成/参加したルームにワンタップで戻れる」ための
// ローカルな履歴としてlocalStorageに保存する。iOS版(UserDefaults)・Android版
// (SharedPreferences)と同じデータモデル・方針。
// 複数のFirebaseアカウントで同じブラウザを使うケースを考慮し、uidごとに
// 別のlocalStorageキーに保存する(サインアウト/別アカウントでの汚染を防ぐため)。

export interface SavedRoom {
  roomId: string
  label: string
  inviteCode: string | null
  lastUsedAt: number
}

const MAX_SAVED_ROOMS = 20

export const useSavedRoomsStore = defineStore('savedRooms', () => {
  const rooms = ref<SavedRoom[]>([])
  let storageKey: string | null = null

  function load(uid: string | null | undefined) {
    if (!uid) {
      storageKey = null
      rooms.value = []
      return
    }
    storageKey = `pttSavedRooms:${uid}`
    try {
      const raw = localStorage.getItem(storageKey)
      rooms.value = raw ? (JSON.parse(raw) as SavedRoom[]) : []
    } catch {
      rooms.value = []
    }
  }

  function persist() {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(rooms.value))
    } catch {
      // 容量超過等はベストエフォート。履歴機能なので失敗しても致命的ではない。
    }
  }

  function upsert(roomId: string, label: string, inviteCode: string | null) {
    if (!storageKey) return
    const filtered = rooms.value.filter((r) => r.roomId !== roomId)
    filtered.unshift({ roomId, label, inviteCode, lastUsedAt: Date.now() })
    rooms.value = filtered.slice(0, MAX_SAVED_ROOMS)
    persist()
  }

  function remove(roomId: string) {
    rooms.value = rooms.value.filter((r) => r.roomId !== roomId)
    persist()
  }

  return { rooms, load, upsert, remove }
})
