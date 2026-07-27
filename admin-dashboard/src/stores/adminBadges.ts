import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, authedFetch } from '@/lib/api'
import type {
  AdminBadge,
  AdminBadgeListResponse,
  BadgeDisplayConfig,
  BadgeGrantMethod,
  BadgeCategory,
  RoomBadgesResponse,
  RoomMemberBadges,
} from '@/types/admin'

// [Phase13] token-server/routes/badges.js のラッパーstore。
//
// [設計方針]
// バッジマスタ(全団体共通の1マスタ、BadgesView.vue向け)と、
// 「特定Roomのメンバーが現在持っているバッジ」(RoomDetailView.vue向け、
// 読み取り専用)を別々の状態として持つ(useAdminOrganizationsStoreの
// organizations一覧/node一覧の分け方と同じ考え方)。
//
// [2026-07-27] 付与/剥奪の実行は`stores/userDirectory.ts`
// (ユーザー管理画面)に一本化した。badgeGrantsがRoomに紐付かない
// ユーザー単位のレコードである以上、Room文脈から操作するのは不自然と
// いうユーザー指摘を受けての変更。このstoreにはマスタCRUDと、Room詳細
// 画面向けの読み取り専用表示のみを残している。

export const useAdminBadgesStore = defineStore('adminBadges', () => {
  const badges = ref<AdminBadge[]>([])
  const isLoadingBadges = ref(false)
  const errorMessage = ref<string | null>(null)
  const isForbidden = ref(false)

  const isSaving = ref(false)
  const saveErrorMessage = ref<string | null>(null)

  const displayConfig = ref<BadgeDisplayConfig | null>(null)

  function resetError() {
    errorMessage.value = null
    isForbidden.value = false
  }

  async function fetchBadges(baseUrl: string) {
    isLoadingBadges.value = true
    resetError()
    try {
      const data = await authedFetch<AdminBadgeListResponse>(baseUrl, '/admin/badges')
      badges.value = data.badges
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isForbidden.value = true
      } else {
        errorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoadingBadges.value = false
    }
  }

  async function createBadge(
    baseUrl: string,
    input: {
      name: string
      icon: string
      description: string | null
      category: BadgeCategory
      grantMethod: BadgeGrantMethod
      priority: number
    },
  ) {
    isSaving.value = true
    saveErrorMessage.value = null
    try {
      const badge = await authedFetch<AdminBadge>(baseUrl, '/admin/badges', { method: 'POST', body: input })
      badges.value = [badge, ...badges.value]
      return badge
    } catch (e) {
      saveErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isSaving.value = false
    }
  }

  /** priority変更・廃止(active toggle)などの部分更新。 */
  async function updateBadge(baseUrl: string, badgeId: string, patch: Partial<AdminBadge>) {
    isSaving.value = true
    saveErrorMessage.value = null
    try {
      const updated = await authedFetch<AdminBadge>(baseUrl, `/admin/badges/${encodeURIComponent(badgeId)}`, {
        method: 'PATCH',
        body: patch,
      })
      badges.value = badges.value.map((b) => (b.badgeId === badgeId ? updated : b))
      return updated
    } catch (e) {
      saveErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isSaving.value = false
    }
  }

  async function fetchDisplayConfig(baseUrl: string) {
    try {
      displayConfig.value = await authedFetch<BadgeDisplayConfig>(baseUrl, '/admin/config/badge-display')
    } catch (e) {
      // マスタ一覧側でforbidden表示を担うため、ここでは黙って諦める
      // (画面の主目的はバッジ一覧のため、設定値の取得失敗で全体を止めない)。
      console.warn('[バッジ表示設定取得エラー]', (e as Error).message)
    }
  }

  async function updateDisplayConfig(baseUrl: string, maxDisplayCount: number) {
    isSaving.value = true
    saveErrorMessage.value = null
    try {
      displayConfig.value = await authedFetch<BadgeDisplayConfig>(baseUrl, '/admin/config/badge-display', {
        method: 'PATCH',
        body: { maxDisplayCount },
      })
    } catch (e) {
      saveErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isSaving.value = false
    }
  }

  // --- Room内メンバーのバッジ(RoomDetailView.vue向け、読み取り専用) ---
  // [2026-07-27] 付与/剥奪はここではなく stores/userDirectory.ts
  // (ユーザー管理画面)で行う。バッジがRoomに紐付かないユーザー単位の
  // 概念であるため、Room詳細画面からの操作は一本化して廃止した。
  // ここに残すのは「このRoomの現在のメンバーが何を持っているか」の
  // 読み取り専用表示のみ。

  const roomBadges = ref<Record<string, RoomMemberBadges>>({})
  const isLoadingRoomBadges = ref(false)
  const roomBadgesErrorMessage = ref<string | null>(null)
  const isRoomBadgesForbidden = ref(false)

  async function fetchRoomBadges(baseUrl: string, roomId: string) {
    isLoadingRoomBadges.value = true
    roomBadgesErrorMessage.value = null
    isRoomBadgesForbidden.value = false
    try {
      const data = await authedFetch<RoomBadgesResponse>(
        baseUrl,
        `/admin/rooms/${encodeURIComponent(roomId)}/badges`,
      )
      roomBadges.value = data.members
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isRoomBadgesForbidden.value = true
      } else {
        roomBadgesErrorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoadingRoomBadges.value = false
    }
  }

  function clearRoomBadges() {
    roomBadges.value = {}
  }

  return {
    badges,
    isLoadingBadges,
    errorMessage,
    isForbidden,
    isSaving,
    saveErrorMessage,
    displayConfig,
    fetchBadges,
    createBadge,
    updateBadge,
    fetchDisplayConfig,
    updateDisplayConfig,
    roomBadges,
    isLoadingRoomBadges,
    roomBadgesErrorMessage,
    isRoomBadgesForbidden,
    fetchRoomBadges,
    clearRoomBadges,
  }
})
