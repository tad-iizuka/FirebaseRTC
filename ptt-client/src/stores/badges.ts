import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch } from '@/lib/api'
import type { GrantableBadge, RoomBadgesResponse, RoomMemberBadges } from '@/types/api'

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

  // [2026-08-04] Room内owner向け付与UI。ownerでなければ常にnull
  // (トークンserver側がowner以外にはnullを返すため、フロント側で
  // role判定を二重に行う必要はない。UI側は「nullなら出さない」だけでよい)。
  const grantableBadges = ref<GrantableBadge[] | null>(null)
  const isGranting = ref(false)
  const grantErrorMessage = ref<string | null>(null)

  let intervalId: ReturnType<typeof setInterval> | null = null

  async function fetchOnce(baseUrl: string, roomId: string) {
    try {
      const data = await authedFetch<RoomBadgesResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/badges`,
      )
      byUid.value = data.members
      grantableBadges.value = data.grantableBadges
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
    grantableBadges.value = null
    errorMessage.value = null
  }

  function topBadgeFor(uid: string) {
    return byUid.value[uid]?.topBadge ?? null
  }

  /**
   * [2026-08-04] Room内owner専用の付与/剥奪。POST/DELETE
   * /rooms/:roomId/members/:targetUid/badges(routes/roomBadges.js)を叩く。
   * サーバー側はさらに、対象のバッジがgrantableByRoomOwner=trueであることを
   * 検証する(lib/badges.js grantBadge/revokeBadge の viaRoomOwner)ため、
   * フロント側は「選択肢に出ているものだけを叩く」以上の権限チェックを
   * 重複実装しない(ban.ts・recording.tsと同じ、サーバーを信頼する設計)。
   * 成功後はfetchOnceで最新状態を取り直し、ポーリング間隔を待たずに
   * UIへ即時反映する。
   */
  async function grantBadgeTo(baseUrl: string, roomId: string, targetUid: string, badgeId: string) {
    isGranting.value = true
    grantErrorMessage.value = null
    try {
      await authedFetch(baseUrl, `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(targetUid)}/badges`, {
        method: 'POST',
        body: { badgeId },
      })
      await fetchOnce(baseUrl, roomId)
    } catch (e) {
      grantErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isGranting.value = false
    }
  }

  async function revokeBadgeFrom(baseUrl: string, roomId: string, targetUid: string, badgeId: string) {
    isGranting.value = true
    grantErrorMessage.value = null
    try {
      await authedFetch(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(targetUid)}/badges/${encodeURIComponent(badgeId)}`,
        { method: 'DELETE' },
      )
      await fetchOnce(baseUrl, roomId)
    } catch (e) {
      grantErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isGranting.value = false
    }
  }

  return {
    byUid,
    errorMessage,
    grantableBadges,
    isGranting,
    grantErrorMessage,
    start,
    stop,
    topBadgeFor,
    grantBadgeTo,
    revokeBadgeFrom,
  }
})
