import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RoomSchedule } from '@/types/api'

// [設計方針]
// token-serverにはルーム一覧を返すAPIが無い(招待制のため「一覧」という概念が薄い)。
// そのため、あくまで「自分が過去に作成/参加したルームにワンタップで戻れる」ための
// ローカルな履歴としてlocalStorageに保存する。iOS版(UserDefaults)・Android版
// (SharedPreferences)と同じデータモデル・方針。
// 複数のFirebaseアカウントで同じブラウザを使うケースを考慮し、uidごとに
// 別のlocalStorageキーに保存する(サインアウト/別アカウントでの汚染を防ぐため)。

// [表示仕様・2026-08-06] 以前は名前未設定時に「招待コードで参加したルーム」という
// 固定文言をlabelとして保存していたが、一覧上での見分けが付きにくいため廃止。
// 上段はルーム名(未設定ならroomIdをそのまま表示、コンポーネント側で判定)、
// 下段は開始/終了時刻(未設定なら空欄)を表示する方針に変更した。そのため
// ここでは「名前が無い」状態をnullのまま保持する(呼び出し側でフォールバック
// 文言を生成しない)。
export interface SavedRoom {
  roomId: string
  name: string | null
  inviteCode: string | null
  lastUsedAt: number
  schedule: RoomSchedule | null
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

  function upsert(
    roomId: string,
    name: string | null,
    inviteCode: string | null,
    schedule: RoomSchedule | null = null,
  ) {
    if (!storageKey) return
    const filtered = rooms.value.filter((r) => r.roomId !== roomId)
    filtered.unshift({ roomId, name, inviteCode, lastUsedAt: Date.now(), schedule })
    rooms.value = filtered.slice(0, MAX_SAVED_ROOMS)
    persist()
  }

  function remove(roomId: string) {
    rooms.value = rooms.value.filter((r) => r.roomId !== roomId)
    persist()
  }

  return { rooms, load, upsert, remove }
})
