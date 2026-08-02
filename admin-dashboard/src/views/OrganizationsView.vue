<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useAdminOrganizationsStore } from '@/stores/adminOrganizations'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import Card from '@/components/ui/Card.vue'
import { cn } from '@/lib/utils'

// [Phase11] README.mdのLong-Term Architecture
// (警備業: Company→Branch→Site、一般: Community→Group)に対応する管理画面。
// 左に団体(organizations)一覧、右に選択中の団体のnodeツリーを表示する
// 2ペイン構成。node横の「このnode配下のRoomを見る」リンクから
// RoomsListViewへ遷移し、そこでクライアント側フィルタをかける
// (RoomsListView.vue参照)。

const router = useRouter()
const settings = useSettingsStore()
const auth = useAuthStore()
const orgs = useAdminOrganizationsStore()

const selectedOrgId = ref<string | null>(null)

/**
 * [2026-08-02追加] `GET /admin/organizations`(一覧)は`organizations:monitor`
 * を要求するため、サイト全体権限を持たない団体スコープのみのadminには
 * 403になる(`orgs.isForbidden`がtrueになる)。その場合でも、
 * `auth.managedOrgIds`(自分がorgRole:'admin'として登録されている団体)
 * が分かっていれば、団体単体取得API(`GET /admin/organizations/:orgId`、
 * canReadOrgで許可される)で個別に取得して一覧に載せる。
 * どちらも取得できない(=一覧も個別取得も権限が無い)場合のみ、下の
 * `orgs.isForbidden`表示に落ちる。
 */
function load() {
  orgs
    .fetchOrganizations(settings.tokenServerUrl)
    .catch(() => {})
    .finally(() => {
      if (auth.managedOrgIds.length > 0) {
        orgs.fetchManagedOrganizations(settings.tokenServerUrl, auth.managedOrgIds).catch(() => {})
      }
    })
}
onMounted(load)

function selectOrg(orgId: string) {
  selectedOrgId.value = orgId
  if (!orgs.nodesByOrgId.has(orgId)) {
    orgs.fetchNodes(settings.tokenServerUrl, orgId).catch(() => {})
  }
}

const selectedNodes = computed(() => {
  if (!selectedOrgId.value) return []
  return orgs.nodesByOrgId.get(selectedOrgId.value) ?? []
})

// depth昇順のフラット配列を、表示上「親の直後に子が並ぶ」順に組み替える。
// (APIはdepth昇順のみを保証しており、親子の並び順までは保証していないため)
const orderedNodes = computed(() => {
  const nodes = selectedNodes.value
  const byParent = new Map<string | null, typeof nodes>()
  for (const n of nodes) {
    const key = n.parentNodeId
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(n)
  }
  const result: typeof nodes = []
  function walk(parentId: string | null) {
    for (const n of byParent.get(parentId) ?? []) {
      result.push(n)
      walk(n.nodeId)
    }
  }
  walk(null)
  return result
})

function viewRoomsForNode(orgId: string, nodeId: string) {
  router.push({ name: 'rooms', query: { orgId, nodeId } })
}
function viewRoomsForOrg(orgId: string) {
  router.push({ name: 'rooms', query: { orgId } })
}

// --- 団体作成フォーム ---
const newOrgName = ref('')
const newOrgIndustryProfile = ref('')

async function createOrg() {
  if (!newOrgName.value.trim()) return
  try {
    const org = await orgs.createOrganization(
      settings.tokenServerUrl,
      newOrgName.value.trim(),
      newOrgIndustryProfile.value.trim() || null,
    )
    newOrgName.value = ''
    newOrgIndustryProfile.value = ''
    selectOrg(org.orgId)
  } catch {
    // createErrorMessageに反映済み
  }
}

// --- node作成フォーム ---
const newNodeName = ref('')
const newNodeParentId = ref<string>('') // '' = 直下(depth 0)

async function createNode() {
  if (!selectedOrgId.value || !newNodeName.value.trim()) return
  try {
    await orgs.createNode(
      settings.tokenServerUrl,
      selectedOrgId.value,
      newNodeName.value.trim(),
      newNodeParentId.value || null,
    )
    newNodeName.value = ''
    newNodeParentId.value = ''
  } catch {
    // createErrorMessageに反映済み
  }
}

// --- [Phase16] チャット添付ファイル保持期間 ---
// 選択中の団体が変わるたびに、現在値(未設定ならデフォルト30日)を入力欄へ反映する。
const retentionDaysInput = ref('')
const selectedOrg = computed(() => orgs.organizations.find((o) => o.orgId === selectedOrgId.value) ?? null)

function onSelectOrg(orgId: string) {
  selectOrg(orgId)
  const org = orgs.organizations.find((o) => o.orgId === orgId)
  retentionDaysInput.value = String(org?.attachmentRetentionDays ?? '')
  if (!orgs.membersByOrgId.has(orgId)) {
    orgs.fetchMembers(settings.tokenServerUrl, orgId).catch(() => {})
  }
}

async function saveRetentionDays() {
  if (!selectedOrgId.value) return
  const trimmed = retentionDaysInput.value.trim()
  const days = trimmed === '' ? null : Number(trimmed)
  if (days !== null && (!Number.isInteger(days) || days <= 0)) return
  try {
    await orgs.updateAttachmentRetentionDays(settings.tokenServerUrl, selectedOrgId.value, days)
  } catch {
    // retentionErrorMessageに反映済み
  }
}

// --- [組織ロースター層、実装着手 2026-08-01] 名簿(所属)管理 ---
// phase11-org-roster-design.md(案C): 所属はアクセス制御の軸にしない。
// ここで付与/編集/剥奪するのはあくまで「団体管理者(admin)/所属staff」の
// 名簿であり、Room roleとは別軸(既存のRoomsListView/RoomDetailViewの
// role管理には一切影響しない)。

const selectedMembers = computed(() => {
  if (!selectedOrgId.value) return []
  return orgs.membersByOrgId.get(selectedOrgId.value) ?? []
})

function nodeName(nodeId: string): string {
  return selectedNodes.value.find((n) => n.nodeId === nodeId)?.name ?? nodeId
}

const newMemberUid = ref('')
const newMemberRole = ref<'admin' | 'staff'>('staff')
const newMemberScopeNodeIds = ref<string[]>([])

async function grantMember() {
  if (!selectedOrgId.value || !newMemberUid.value.trim()) return
  try {
    await orgs.grantMember(
      settings.tokenServerUrl,
      selectedOrgId.value,
      newMemberUid.value.trim(),
      newMemberRole.value,
      newMemberRole.value === 'admin' ? newMemberScopeNodeIds.value : [],
    )
    newMemberUid.value = ''
    newMemberRole.value = 'staff'
    newMemberScopeNodeIds.value = []
  } catch {
    // memberMutationErrorMessageに反映済み
  }
}

// 編集中の行(uid)だけscope選択UIを開く。同時に複数行を編集させない
// (誤操作防止。AdminsView.vue等と違い、ここは1行ごとの状態を持つ複雑な
// フォームのため単純なグローバルref2本(uid/permission)では表現しづらい)。
const editingUid = ref<string | null>(null)
const editRole = ref<'admin' | 'staff'>('staff')
const editScopeNodeIds = ref<string[]>([])

function startEdit(member: (typeof selectedMembers.value)[number]) {
  editingUid.value = member.uid
  editRole.value = member.orgRole
  editScopeNodeIds.value = [...member.scopeNodeIds]
}
function cancelEdit() {
  editingUid.value = null
}
async function saveEdit() {
  if (!selectedOrgId.value || !editingUid.value) return
  try {
    await orgs.editMember(
      settings.tokenServerUrl,
      selectedOrgId.value,
      editingUid.value,
      editRole.value,
      editRole.value === 'admin' ? editScopeNodeIds.value : [],
    )
    editingUid.value = null
  } catch {
    // memberMutationErrorMessageに反映済み(編集フォームは開いたままにする)
  }
}

async function revokeMember(uid: string) {
  if (!selectedOrgId.value) return
  try {
    await orgs.revokeMember(settings.tokenServerUrl, selectedOrgId.value, uid)
    if (editingUid.value === uid) editingUid.value = null
  } catch {
    // memberMutationErrorMessageに反映済み
  }
}
</script>

<template>
  <div class="grid grid-cols-1 gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
    <!-- 左ペイン: 団体一覧 -->
    <div>
      <h2 class="mb-2 text-[12px] font-medium">団体</h2>

      <!-- [2026-08-02変更] 一覧取得(organizations:monitor)が403でも、
           managedOrgIds経由で1件以上取得できていれば、その分は表示する
           (scope限定adminにも自分の団体は見えるようにするため)。 -->
      <p
        v-if="orgs.isForbidden && orgs.organizations.length === 0"
        class="text-xs text-destructive"
      >
        管理者権限がありません。
      </p>
      <p v-else-if="orgs.errorMessage && orgs.organizations.length === 0" class="text-xs text-destructive">
        団体一覧の取得に失敗しました: {{ orgs.errorMessage }}
      </p>
      <p
        v-else-if="orgs.isLoadingOrganizations && orgs.organizations.length === 0"
        class="text-xs text-muted-foreground"
      >
        読み込み中...
      </p>
      <p
        v-else-if="!orgs.isLoadingOrganizations && orgs.organizations.length === 0"
        class="text-xs text-muted-foreground"
      >
        — 団体なし —
      </p>

      <div class="grid gap-2">
        <Card
          v-for="org in orgs.organizations"
          :key="org.orgId"
          :class="
            cn(
              'cursor-pointer p-3 transition-colors hover:bg-white/5',
              selectedOrgId === org.orgId && 'border-primary',
            )
          "
          @click="onSelectOrg(org.orgId)"
        >
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="text-xs font-medium">{{ org.name }}</span>
            <Badge v-if="org.industryProfile">{{ org.industryProfile }}</Badge>
          </div>
          <div class="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Room数: {{ org.roomCount ?? '—' }}</span>
            <button
              type="button"
              class="text-primary underline-offset-2 hover:underline"
              @click.stop="viewRoomsForOrg(org.orgId)"
            >
              Room一覧へ
            </button>
          </div>
        </Card>
      </div>

      <h3 class="mb-2 mt-5 text-[11px] font-medium text-muted-foreground">団体を新規作成</h3>
      <div class="grid gap-2">
        <Input v-model="newOrgName" placeholder="団体名(例: 〇〇警備保障株式会社)" />
        <Input v-model="newOrgIndustryProfile" placeholder="industryProfile(任意, 例: security)" />
        <Button size="sm" class="w-auto" :disabled="orgs.isCreating" @click="createOrg">
          {{ orgs.isCreating ? '作成中...' : '団体を作成' }}
        </Button>
        <p v-if="orgs.createErrorMessage" class="text-xs text-destructive">{{ orgs.createErrorMessage }}</p>
      </div>
    </div>

    <!-- 右ペイン: 選択中の団体のnodeツリー -->
    <div>
      <h2 class="mb-2 text-[12px] font-medium">
        階層 <span v-if="selectedOrgId" class="text-muted-foreground">— {{
          orgs.organizations.find((o) => o.orgId === selectedOrgId)?.name
        }}</span>
      </h2>

      <p v-if="!selectedOrgId" class="text-xs text-muted-foreground">左の一覧から団体を選択してください。</p>

      <template v-else>
        <div class="mb-5 max-w-md rounded-sm border border-border p-3">
          <h3 class="mb-2 text-[11px] font-medium text-muted-foreground">
            チャット添付ファイルの保持期間【Phase16】
          </h3>
          <div class="flex items-center gap-2">
            <Input
              v-model="retentionDaysInput"
              type="number"
              min="1"
              placeholder="30"
              class="w-24"
            />
            <span class="text-xs text-muted-foreground">日(空欄でデフォルト30日)</span>
            <Button size="sm" class="w-auto" :disabled="orgs.isUpdatingRetention" @click="saveRetentionDays">
              {{ orgs.isUpdatingRetention ? '保存中...' : '保存' }}
            </Button>
          </div>
          <p class="mt-1 text-[11px] text-muted-foreground">
            現在値: {{ selectedOrg?.attachmentRetentionDays ?? 'デフォルト(30日)' }}。
            この団体に割り当てられたRoomの画像/動画/PDF添付が、送信からこの日数を
            過ぎると自動的に削除される。
          </p>
          <p v-if="orgs.retentionErrorMessage" class="mt-1 text-xs text-destructive">
            {{ orgs.retentionErrorMessage }}
          </p>
        </div>

        <p v-if="orgs.nodesErrorMessage" class="text-xs text-destructive">{{ orgs.nodesErrorMessage }}</p>
        <p
          v-else-if="orgs.isLoadingNodes && selectedNodes.length === 0"
          class="text-xs text-muted-foreground"
        >
          読み込み中...
        </p>
        <p
          v-else-if="!orgs.isLoadingNodes && selectedNodes.length === 0"
          class="text-xs text-muted-foreground"
        >
          — nodeなし(団体直下にRoomを割り当てる場合はnode不要です) —
        </p>

        <ul class="mb-5 grid gap-1">
          <li
            v-for="node in orderedNodes"
            :key="node.nodeId"
            class="flex items-center justify-between gap-2 rounded-sm border border-border px-2 py-1.5 text-xs"
            :style="{ marginLeft: `${node.depth * 1.25}rem` }"
          >
            <span>{{ node.name }} <span class="text-[10px] text-muted-foreground">(depth {{ node.depth }})</span></span>
            <button
              type="button"
              class="text-[11px] text-primary underline-offset-2 hover:underline"
              @click="viewRoomsForNode(selectedOrgId!, node.nodeId)"
            >
              このnode配下のRoomを見る
            </button>
          </li>
        </ul>

        <h3 class="mb-2 text-[11px] font-medium text-muted-foreground">nodeを新規作成</h3>
        <div class="grid max-w-md gap-2">
          <Input v-model="newNodeName" placeholder="node名(例: 東京支社 / △△現場)" />
          <select
            v-model="newNodeParentId"
            class="h-10 rounded-sm border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-primary"
          >
            <option value="">親なし(直下, depth 0)</option>
            <option v-for="node in orderedNodes" :key="node.nodeId" :value="node.nodeId">
              {{ '　'.repeat(node.depth) }}{{ node.name }} の子として作成
            </option>
          </select>
          <Button size="sm" class="w-auto" :disabled="orgs.isCreating" @click="createNode">
            {{ orgs.isCreating ? '作成中...' : 'nodeを作成' }}
          </Button>
          <p v-if="orgs.createErrorMessage" class="text-xs text-destructive">{{ orgs.createErrorMessage }}</p>
        </div>

        <!-- [組織ロースター層、実装着手 2026-08-01] 名簿(所属)管理 -->
        <h3 class="mb-2 mt-5 text-[11px] font-medium text-muted-foreground">
          名簿(所属)
          <span class="font-normal normal-case tracking-normal">
            — この団体のadmin/staff。Roomへの参加権限(role)には影響しません
          </span>
        </h3>

        <p v-if="orgs.isMembersForbidden" class="text-xs text-destructive">
          この団体の名簿を閲覧する権限がありません(rootまたはこの団体のadminのみ)。
        </p>
        <p v-else-if="orgs.membersErrorMessage" class="text-xs text-destructive">
          名簿の取得に失敗しました: {{ orgs.membersErrorMessage }}
        </p>
        <template v-else>
          <p
            v-if="orgs.isLoadingMembers && selectedMembers.length === 0"
            class="text-xs text-muted-foreground"
          >
            読み込み中...
          </p>
          <p
            v-else-if="!orgs.isLoadingMembers && selectedMembers.length === 0"
            class="text-xs text-muted-foreground"
          >
            — 名簿は空です —
          </p>

          <ul class="mb-3 grid gap-1">
            <li
              v-for="member in selectedMembers"
              :key="member.uid"
              class="rounded-sm border border-border px-2 py-1.5 text-xs"
            >
              <div v-if="editingUid !== member.uid" class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate font-mono">{{ member.uid }}</span>
                    <Badge :variant="member.orgRole === 'admin' ? 'accent' : 'default'">
                      {{ member.orgRole === 'admin' ? 'admin' : 'staff' }}
                    </Badge>
                  </div>
                  <div v-if="member.orgRole === 'admin'" class="mt-0.5 text-[11px] text-muted-foreground">
                    <span v-if="member.scopeNodeIds.length === 0">団体全体を管理</span>
                    <span v-else>scope: {{ member.scopeNodeIds.map(nodeName).join(', ') }}</span>
                  </div>
                </div>
                <div class="flex shrink-0 gap-2">
                  <button
                    type="button"
                    class="text-[11px] text-primary underline-offset-2 hover:underline"
                    @click="startEdit(member)"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    class="text-[11px] text-destructive underline-offset-2 hover:underline"
                    @click="revokeMember(member.uid)"
                  >
                    除名
                  </button>
                </div>
              </div>

              <!-- 編集フォーム(この行のみ展開) -->
              <div v-else class="grid gap-2">
                <div class="flex items-center gap-1.5">
                  <span class="truncate font-mono">{{ member.uid }}</span>
                </div>
                <select
                  v-model="editRole"
                  class="h-9 rounded-sm border border-input bg-background px-2 font-mono text-xs text-foreground outline-none focus:border-primary"
                >
                  <option value="staff">staff(管理権限なし)</option>
                  <option value="admin">admin(scope管理者)</option>
                </select>
                <select
                  v-if="editRole === 'admin'"
                  v-model="editScopeNodeIds"
                  multiple
                  class="h-24 rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
                >
                  <option v-for="node in orderedNodes" :key="node.nodeId" :value="node.nodeId">
                    {{ '　'.repeat(node.depth) }}{{ node.name }}
                  </option>
                </select>
                <p v-if="editRole === 'admin' && editScopeNodeIds.length === 0" class="text-[11px] text-muted-foreground">
                  未選択のまま保存すると「団体全体を管理」になります(Ctrl/Cmd+クリックで複数選択可)。
                </p>
                <div class="flex gap-2">
                  <Button size="sm" class="w-auto" :disabled="orgs.isMutatingMember" @click="saveEdit">
                    {{ orgs.isMutatingMember ? '保存中...' : '保存' }}
                  </Button>
                  <Button size="sm" variant="secondary" class="w-auto" @click="cancelEdit">キャンセル</Button>
                </div>
              </div>
            </li>
          </ul>

          <h4 class="mb-2 text-[11px] font-medium text-muted-foreground">名簿へ新規登録</h4>
          <div class="grid max-w-md gap-2">
            <Input v-model="newMemberUid" placeholder="対象のuid(先にMember登録済みである必要があります)" />
            <select
              v-model="newMemberRole"
              class="h-10 rounded-sm border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="staff">staff(管理権限なし)</option>
              <option value="admin">admin(scope管理者)</option>
            </select>
            <select
              v-if="newMemberRole === 'admin'"
              v-model="newMemberScopeNodeIds"
              multiple
              class="h-24 rounded-sm border border-input bg-background px-3 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
            >
              <option v-for="node in orderedNodes" :key="node.nodeId" :value="node.nodeId">
                {{ '　'.repeat(node.depth) }}{{ node.name }}
              </option>
            </select>
            <p v-if="newMemberRole === 'admin'" class="text-[11px] text-muted-foreground">
              未選択のまま登録すると「団体全体を管理」になります(Ctrl/Cmd+クリックで複数選択可)。
              あなた自身の管理範囲を超えるscopeは登録できません。
            </p>
            <Button size="sm" class="w-auto" :disabled="orgs.isMutatingMember || !newMemberUid.trim()" @click="grantMember">
              {{ orgs.isMutatingMember ? '登録中...' : '名簿へ登録' }}
            </Button>
            <p v-if="orgs.memberMutationErrorMessage" class="text-xs text-destructive">
              {{ orgs.memberMutationErrorMessage }}
            </p>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
