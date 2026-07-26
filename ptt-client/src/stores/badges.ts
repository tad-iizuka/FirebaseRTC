import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch } from '@/lib/api'
import type { RoomBadgesResponse, RoomMemberBadges } from '@/types/api'

// [Phase13] 参加者一覧でのバッジ表示(最優先1件のみ)。
//
// [設計方針] 送話ロック・録音状態のようにLiveKit Room Metadata経由の
// リアルタイム反映は行わない(バッジの変化頻度は低く、Owner操作の即時性が
// 強く求められる性質のものでもないため)。ban.ts の myRole 取得のように
// Firestoreへ直接onSnapshotすることもしない(badges/badgeGrantsは
// firestore.rulesでクライアントへの直接読み取りを禁止しているため、
// そもそも購読できない)。
//
// GET /rooms/:roomId/badges を一定間隔でポーリングする、admin-dashboard の
// usePolling と同じ考え方のシンプルな実装にとどめる(Phase13はPoCスコープ)。
const POLL_INTERVAL_MS = 20000

export const useBadgesStore = defineStore('badges', () => {
  // uid -> そのメンバーの現在のバッジ情報(topBadgeのみ参照する想定だが、
  // 将来のプロフィール画面用にbadges全件も保持しておく)。
  const byUid = ref<Record<string, RoomMemberBadges>>({})
  const errorMessage = ref<string | null>(null)

  let intervalId: ReturnType<typeof setInterval> | null = null

  async function fetchOnce(baseUrl: string, roomId: string) {
    try {
      const data = await authedFetch<RoomBadgesResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/badges`,
      )
      byUid.value = data.members
      errorMessage.value = null
    } catch (e) {
      // ポーリングの一時的な失敗でUI全体を止めたくないため、エラーは
      // 保持するのみでthrowしない(recording.ts等の操作系storeとは異なり、
      // これは表示専用の補助情報のため)。
      errorMessage.value = (e as Error).message
    }
  }

  function start(baseUrl: string, roomId: string) {
    stop()
    fetchOnce(baseUrl, roomId)
    intervalId = setInterval(() => fetchOnce(baseUrl, roomId), POLL_INTERVAL_MS)
  }

  function stop() {
    if (intervalId) clearInterval(intervalId)
    intervalId = null
    byUid.value = {}
    errorMessage.value = null
  }

  function topBadgeFor(uid: string) {
    return byUid.value[uid]?.topBadge ?? null
  }

  return { byUid, errorMessage, start, stop, topBadgeFor }
})
