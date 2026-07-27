import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, authedFetch } from '@/lib/api'
import type {
  AdminOrganization,
  AdminOrganizationListResponse,
  AdminOrgNode,
  AdminOrgNodeListResponse,
  RoomOrgAssignment,
} from '@/types/admin'

// [Phase11] token-server/routes/organizations.js のラッパーstore。
//
// [設計方針]
// organizations一覧と「選択中の団体のnode一覧」を別々のref/ローディング状態で持つ。
// 団体一覧画面では複数の団体を横に並べつつ、選択した団体のnodeツリーだけを
// 都度取得する想定のため(useAdminRoomsStoreのrooms一覧/detailの分け方と同じ
// 考え方)。
//
// nodeキャッシュは orgId をキーにした Map で保持し、団体を切り替えて戻ってきた際に
// 再取得なしで表示できるようにしている(node数は少ない前提のため、キャッシュの
// 無効化タイミングはシビアに考えず、作成成功時にそのorgIdの分だけ更新する)。

export const useAdminOrganizationsStore = defineStore('adminOrganizations', () => {
  const organizations = ref<AdminOrganization[]>([])
  const isLoadingOrganizations = ref(false)
  const errorMessage = ref<string | null>(null)
  const isForbidden = ref(false)

  const nodesByOrgId = ref<Map<string, AdminOrgNode[]>>(new Map())
  const isLoadingNodes = ref(false)
  const nodesErrorMessage = ref<string | null>(null)

  const isCreating = ref(false)
  const createErrorMessage = ref<string | null>(null)

  function resetError() {
    errorMessage.value = null
    isForbidden.value = false
  }

  async function fetchOrganizations(baseUrl: string) {
    isLoadingOrganizations.value = true
    resetError()
    try {
      const data = await authedFetch<AdminOrganizationListResponse>(baseUrl, '/admin/organizations')
      organizations.value = data.organizations
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isForbidden.value = true
      } else {
        errorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoadingOrganizations.value = false
    }
  }

  async function fetchNodes(baseUrl: string, orgId: string) {
    isLoadingNodes.value = true
    nodesErrorMessage.value = null
    try {
      const data = await authedFetch<AdminOrgNodeListResponse>(
        baseUrl,
        `/admin/organizations/${encodeURIComponent(orgId)}/nodes`,
      )
      nodesByOrgId.value.set(orgId, data.nodes)
    } catch (e) {
      nodesErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isLoadingNodes.value = false
    }
  }

  async function createOrganization(baseUrl: string, name: string, industryProfile: string | null) {
    isCreating.value = true
    createErrorMessage.value = null
    try {
      const org = await authedFetch<AdminOrganization>(baseUrl, '/admin/organizations', {
        method: 'POST',
        body: { name, industryProfile: industryProfile || undefined },
      })
      organizations.value = [org, ...organizations.value]
      return org
    } catch (e) {
      createErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isCreating.value = false
    }
  }

  async function createNode(baseUrl: string, orgId: string, name: string, parentNodeId: string | null) {
    isCreating.value = true
    createErrorMessage.value = null
    try {
      const node = await authedFetch<AdminOrgNode & { ancestorIds: string[] }>(
        baseUrl,
        `/admin/organizations/${encodeURIComponent(orgId)}/nodes`,
        { method: 'POST', body: { name, parentNodeId } },
      )
      const existing = nodesByOrgId.value.get(orgId) || []
      nodesByOrgId.value.set(orgId, [...existing, node])
      // 団体一覧のroomCount等には影響しないため organizations 側の再取得は不要
      return node
    } catch (e) {
      createErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isCreating.value = false
    }
  }

  /**
   * Roomを組織階層へ割り当てる(orgId/nodeIdどちらもnullで無所属に戻せる)。
   * 呼び出し元(RoomDetailView.vue)が成功後にroom detailを再取得する想定
   * (このstore自体はroom detailを保持しないため)。
   */
  const isAssigning = ref(false)
  const assignErrorMessage = ref<string | null>(null)

  async function assignRoomOrg(
    baseUrl: string,
    roomId: string,
    orgId: string | null,
    nodeId: string | null,
  ) {
    isAssigning.value = true
    assignErrorMessage.value = null
    try {
      return await authedFetch<RoomOrgAssignment>(
        baseUrl,
        `/admin/rooms/${encodeURIComponent(roomId)}/org-assignment`,
        { method: 'PATCH', body: { orgId, nodeId } },
      )
    } catch (e) {
      assignErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isAssigning.value = false
    }
  }

  /**
   * [Phase16] 団体単位のチャット添付ファイル保持期間(日数)を更新する。
   * nullを渡すとデフォルト(30日)へ戻す(token-server/lib/attachments.js参照)。
   */
  const isUpdatingRetention = ref(false)
  const retentionErrorMessage = ref<string | null>(null)

  async function updateAttachmentRetentionDays(baseUrl: string, orgId: string, days: number | null) {
    isUpdatingRetention.value = true
    retentionErrorMessage.value = null
    try {
      const result = await authedFetch<{ orgId: string; attachmentRetentionDays: number | null }>(
        baseUrl,
        `/admin/organizations/${encodeURIComponent(orgId)}`,
        { method: 'PATCH', body: { attachmentRetentionDays: days } },
      )
      organizations.value = organizations.value.map((org) =>
        org.orgId === orgId ? { ...org, attachmentRetentionDays: result.attachmentRetentionDays } : org,
      )
      return result
    } catch (e) {
      retentionErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isUpdatingRetention.value = false
    }
  }

  return {
    organizations,
    isLoadingOrganizations,
    errorMessage,
    isForbidden,
    nodesByOrgId,
    isLoadingNodes,
    nodesErrorMessage,
    isCreating,
    createErrorMessage,
    isAssigning,
    assignErrorMessage,
    isUpdatingRetention,
    retentionErrorMessage,
    fetchOrganizations,
    fetchNodes,
    createOrganization,
    createNode,
    assignRoomOrg,
    updateAttachmentRetentionDays,
  }
})
