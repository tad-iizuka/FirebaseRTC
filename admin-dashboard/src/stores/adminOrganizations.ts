import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ApiError, authedFetch } from '@/lib/api'
import type {
  AdminOrganization,
  AdminOrganizationListResponse,
  AdminOrgNode,
  AdminOrgNodeListResponse,
  OrgMember,
  OrgMemberListResponse,
  OrgRole,
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

  /**
   * [2026-08-02追加] 団体単体取得(GET /admin/organizations/:orgId)。
   * `organizations:monitor`を持たないscope限定adminが、自分の管理する
   * 団体(`managedOrgIds`)を一覧APIを経由せずに取得するための入口。
   * 取得結果は`organizations`配列へupsertする(一覧取得が403で
   * 空のままでも、この団体だけは表示できるようにするため)。
   */
  async function fetchOrganizationById(baseUrl: string, orgId: string) {
    const org = await authedFetch<AdminOrganization>(baseUrl, `/admin/organizations/${encodeURIComponent(orgId)}`)
    const idx = organizations.value.findIndex((o) => o.orgId === orgId)
    if (idx === -1) {
      organizations.value = [...organizations.value, org]
    } else {
      organizations.value = organizations.value.map((o) => (o.orgId === orgId ? org : o))
    }
    return org
  }

  /**
   * [2026-08-02追加] `auth.managedOrgIds`のうち、まだ`organizations`に
   * 載っていない団体だけをまとめて取得する。`fetchOrganizations`が403で
   * 終わった場合(=organizations:monitorを持たないscope限定admin)でも、
   * こちらは団体ごとに独立して判定されるため失敗しない
   * (自分が名簿登録されている団体である以上、`canReadOrg`側で許可される)。
   * 個々の取得失敗は握りつぶす(1つの団体の取得失敗で他の表示まで
   * 巻き込まないため)。
   */
  async function fetchManagedOrganizations(baseUrl: string, orgIds: string[]) {
    const known = new Set(organizations.value.map((o) => o.orgId))
    const missing = orgIds.filter((id) => !known.has(id))
    await Promise.all(
      missing.map((orgId) =>
        fetchOrganizationById(baseUrl, orgId).catch((e) => {
          console.error(`[組織階層] 団体単体取得失敗 orgId=${orgId}`, e)
        }),
      ),
    )
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

  /**
   * [組織ロースター層、実装着手 2026-08-01]
   * organizations/{orgId}/members のラッパー。token-server側の権限判定
   * (root / 団体全体admin / scope限定admin)は動的なため、他のセクション
   * (organizations一覧のorganizations:monitor等)と違い、ここでは
   * isForbiddenの単一フラグではなく、呼び出しごとのエラーメッセージで
   * 表現する(scope超過(403)とネットワークエラーを厳密に区別する必要が
   * 薄いため。UsersView.vue等の既存パターンと揃えている)。
   */
  const membersByOrgId = ref<Map<string, OrgMember[]>>(new Map())
  const isLoadingMembers = ref(false)
  const membersErrorMessage = ref<string | null>(null)
  const isMembersForbidden = ref(false)

  const isMutatingMember = ref(false)
  const memberMutationErrorMessage = ref<string | null>(null)

  async function fetchMembers(baseUrl: string, orgId: string) {
    isLoadingMembers.value = true
    membersErrorMessage.value = null
    isMembersForbidden.value = false
    try {
      const data = await authedFetch<OrgMemberListResponse>(
        baseUrl,
        `/admin/organizations/${encodeURIComponent(orgId)}/members`,
      )
      membersByOrgId.value.set(orgId, data.members)
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 403) {
        isMembersForbidden.value = true
      } else {
        membersErrorMessage.value = (e as Error).message
      }
      throw e
    } finally {
      isLoadingMembers.value = false
    }
  }

  /** 名簿への新規登録(所属付与)。POST /admin/organizations/:orgId/members/:targetUid */
  async function grantMember(
    baseUrl: string,
    orgId: string,
    targetUid: string,
    orgRole: OrgRole,
    scopeNodeIds: string[],
  ) {
    isMutatingMember.value = true
    memberMutationErrorMessage.value = null
    try {
      const member = await authedFetch<OrgMember>(
        baseUrl,
        `/admin/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(targetUid)}`,
        { method: 'POST', body: { orgRole, scopeNodeIds: orgRole === 'admin' ? scopeNodeIds : undefined } },
      )
      const existing = membersByOrgId.value.get(orgId) || []
      membersByOrgId.value.set(orgId, [...existing, member])
      return member
    } catch (e) {
      memberMutationErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isMutatingMember.value = false
    }
  }

  /** role/scopeの変更。PATCH /admin/organizations/:orgId/members/:targetUid */
  async function editMember(
    baseUrl: string,
    orgId: string,
    targetUid: string,
    orgRole: OrgRole,
    scopeNodeIds: string[],
  ) {
    isMutatingMember.value = true
    memberMutationErrorMessage.value = null
    try {
      const updated = await authedFetch<{ uid: string; orgRole: OrgRole; scopeNodeIds: string[] }>(
        baseUrl,
        `/admin/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(targetUid)}`,
        { method: 'PATCH', body: { orgRole, scopeNodeIds: orgRole === 'admin' ? scopeNodeIds : undefined } },
      )
      const existing = membersByOrgId.value.get(orgId) || []
      membersByOrgId.value.set(
        orgId,
        existing.map((m) => (m.uid === targetUid ? { ...m, orgRole: updated.orgRole, scopeNodeIds: updated.scopeNodeIds } : m)),
      )
      return updated
    } catch (e) {
      memberMutationErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isMutatingMember.value = false
    }
  }

  /** 名簿からの除名(所属剥奪)。DELETE /admin/organizations/:orgId/members/:targetUid */
  async function revokeMember(baseUrl: string, orgId: string, targetUid: string) {
    isMutatingMember.value = true
    memberMutationErrorMessage.value = null
    try {
      await authedFetch<{ uid: string; revoked: boolean }>(
        baseUrl,
        `/admin/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(targetUid)}`,
        { method: 'DELETE' },
      )
      const existing = membersByOrgId.value.get(orgId) || []
      membersByOrgId.value.set(
        orgId,
        existing.filter((m) => m.uid !== targetUid),
      )
    } catch (e) {
      memberMutationErrorMessage.value = (e as Error).message
      throw e
    } finally {
      isMutatingMember.value = false
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
    membersByOrgId,
    isLoadingMembers,
    membersErrorMessage,
    isMembersForbidden,
    isMutatingMember,
    memberMutationErrorMessage,
    fetchOrganizations,
    fetchOrganizationById,
    fetchManagedOrganizations,
    fetchNodes,
    createOrganization,
    createNode,
    assignRoomOrg,
    updateAttachmentRetentionDays,
    fetchMembers,
    grantMember,
    editMember,
    revokeMember,
  }
})
