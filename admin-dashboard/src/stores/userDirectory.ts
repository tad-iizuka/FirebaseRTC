import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, authedFetch } from '@/lib/api'
import type { AppUserListResponse, AppUserProfile, AppUserSummary, BadgeGrantResult } from '@/types/admin'

/**
 * [2026-07-27新設] UsersView.vue(一覧・検索)・UserDetailView.vue(プロフィール・
 * バッジ付与/剥奪)向けのstore。
 *
 * [なぜ`adminUsers`ストアと別なのか] `stores/adminUsers.ts`は既に
 * 「サイト管理者権限を持つ人」(AdminsView.vue「管理者権限」タブ)を扱う
 * store名として使われている別概念のため、ここでは`userDirectory`という
 * 別名にしている(扱う対象はFirebase Authの一般ユーザー全体で、
 * サイト管理者かどうかとは無関係)。
 *
 * 「バッジマスタ(全体で1種類の定義)」を扱うuseAdminBadgesStoreとは別に、
 * 「個々のユーザーが何を持っているか」を扱うstoreとして分離している
 * (useAdminBadgesStoreがマスタ一覧とRoom内メンバーのバッジ一覧を分けて
 * 持つのと同じ考え方)。
 */
export const useUserDirectoryStore = defineStore('userDirectory', () => {
  // --- 一覧・検索(UsersView.vue向け) ---
  const users = ref<AppUserSummary[]>([])
  const nextPageToken = ref<string | null>(null)
  const isLoadingUsers = ref(false)
  const errorMessage = ref<string | null>(null)
  const isForbidden = ref(false)

  function resetListError() {
    errorMessage.value = null
    isForbidden.value = false
  }

  /**
   * @param append trueの場合、既存のusersに追記する(「もっと読み込む」用)。
   *   falseの場合は置き換える(検索文字列を変えた場合)。
   */
  async function searchUsers(baseUrl: string, email: string, { append = false }: { append?: boolean } = {}) {
    isLoadingUsers.value = true
    resetListError()
    try {
      const params = new URLSearchParams()
      if (email) params.set('email', email)
      if (append && nextPageToken.value) params.set('pageToken', nextPageToken.value)

      const data = await authedFetch<AppUserListResponse>(baseUrl, `/admin/users?${params.toString()}`)
      users.value = append ? [...users.value, ...data.users] : data.users
      nextPageToken.value = data.nextPageToken
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isForbidden.value = true
      } else {
        errorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoadingUsers.value = false
    }
  }

  // --- プロフィール(UserDetailView.vue向け) ---
  const profile = ref<AppUserProfile | null>(null)
  const isLoadingProfile = ref(false)
  const profileErrorMessage = ref<string | null>(null)
  const isProfileForbidden = ref(false)
  const isProfileNotFound = ref(false)

  const isGranting = ref(false)
  const grantErrorMessage = ref<string | null>(null)

  async function fetchProfile(baseUrl: string, uid: string) {
    isLoadingProfile.value = true
    profileErrorMessage.value = null
    isProfileForbidden.value = false
    isProfileNotFound.value = false
    try {
      profile.value = await authedFetch<AppUserProfile>(baseUrl, `/admin/users/${encodeURIComponent(uid)}`)
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isProfileForbidden.value = true
      } else if (e instanceof ApiError && e.statusCode === 404) {
        isProfileNotFound.value = true
      } else {
        profileErrorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoadingProfile.value = false
    }
  }

  async function grantBadge(baseUrl: string, uid: string, badgeId: string) {
    grantErrorMessage.value = null
    isGranting.value = true
    try {
      const result = await authedFetch<BadgeGrantResult>(baseUrl, `/admin/users/${encodeURIComponent(uid)}/badges`, {
        method: 'POST',
        body: { badgeId },
      })
      await fetchProfile(baseUrl, uid)
      return result
    } catch (e) {
      grantErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isGranting.value = false
    }
  }

  async function revokeBadge(baseUrl: string, uid: string, badgeId: string) {
    grantErrorMessage.value = null
    isGranting.value = true
    try {
      await authedFetch<void>(
        baseUrl,
        `/admin/users/${encodeURIComponent(uid)}/badges/${encodeURIComponent(badgeId)}`,
        { method: 'DELETE' },
      )
      await fetchProfile(baseUrl, uid)
    } catch (e) {
      grantErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isGranting.value = false
    }
  }

  function clearProfile() {
    profile.value = null
  }

  return {
    users,
    nextPageToken,
    isLoadingUsers,
    errorMessage,
    isForbidden,
    searchUsers,
    profile,
    isLoadingProfile,
    profileErrorMessage,
    isProfileForbidden,
    isProfileNotFound,
    isGranting,
    grantErrorMessage,
    fetchProfile,
    grantBadge,
    revokeBadge,
    clearProfile,
  }
})
