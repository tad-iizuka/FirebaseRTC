import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, authedFetch } from '@/lib/api'
import type { AdminUserEntry, AdminUserListResponse } from '@/types/admin'

// [Phase8] GET /admin/admins, POST /admin/admins/:uid/permissions のラッパーstore。
// admins:manage 自体の付与/剥奪はサーバー側(token-server/routes/admin.js)で
// 常に403で拒否される設計になっているため、ここでも事前にクライアント側で
// 弾いてUXを良くしているだけで、実際の権限強制はサーバー側の責務。

export const useAdminUsersStore = defineStore('adminUsers', () => {
  const admins = ref<AdminUserEntry[]>([])
  const isLoading = ref(false)
  const errorMessage = ref<string | null>(null)
  const isForbidden = ref(false)

  function resetError() {
    errorMessage.value = null
    isForbidden.value = false
  }

  async function fetchAdmins(baseUrl: string) {
    isLoading.value = true
    resetError()
    try {
      const data = await authedFetch<AdminUserListResponse>(baseUrl, '/admin/admins')
      admins.value = data.admins
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

  async function changePermission(
    baseUrl: string,
    uid: string,
    permission: string,
    action: 'grant' | 'revoke',
  ) {
    errorMessage.value = null
    if (permission === 'admins:manage') {
      errorMessage.value =
        'admins:manage の付与/剥奪はこの画面では行えません(dev-tools/grant-admin-permission.js を使用してください)'
      throw new Error(errorMessage.value)
    }
    try {
      await authedFetch(baseUrl, `/admin/admins/${encodeURIComponent(uid)}/permissions`, {
        method: 'POST',
        body: { permission, action },
      })
      await fetchAdmins(baseUrl)
    } catch (e) {
      errorMessage.value = (e as Error).message
      throw e
    }
  }

  return { admins, isLoading, errorMessage, isForbidden, fetchAdmins, changePermission }
})
