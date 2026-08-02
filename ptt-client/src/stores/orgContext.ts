import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch } from '@/lib/api'
import type { OrgContextResponse } from '@/types/api'

// [パンくず表示・組織階層] GET /rooms/:roomId/org-context を参照する。
//
// [設計方針] badges.tsとは異なりポーリングしない。Roomの組織階層への
// 割り当て(orgId/nodeId)はadmin-dashboard側での管理者操作でのみ変わり、
// 変化頻度・即時反映の要求のいずれも低いため、入室時に1回取得すれば十分と
// 判断した(送話ロック・録音状態のようなLiveKit Room Metadata経由の
// リアルタイム反映は不要)。
export const useOrgContextStore = defineStore('orgContext', () => {
  const orgId = ref<string | null>(null)
  const orgName = ref<string | null>(null)
  const breadcrumb = ref<OrgContextResponse['breadcrumb']>([])
  const errorMessage = ref<string | null>(null)

  async function fetchOnce(baseUrl: string, roomId: string) {
    try {
      const data = await authedFetch<OrgContextResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/org-context`,
      )
      orgId.value = data.orgId
      orgName.value = data.orgName
      breadcrumb.value = data.breadcrumb
      errorMessage.value = null
    } catch (e) {
      // 無所属Roomの方が多数派になりうる想定のため、取得失敗時も
      // UI全体を止めず「表示しない」で済ませる(badges.tsと同じ方針)。
      errorMessage.value = (e as Error).message
    }
  }

  function reset() {
    orgId.value = null
    orgName.value = null
    breadcrumb.value = []
    errorMessage.value = null
  }

  return { orgId, orgName, breadcrumb, errorMessage, fetchOnce, reset }
})
