<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
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
const orgs = useAdminOrganizationsStore()

const selectedOrgId = ref<string | null>(null)

function load() {
  orgs.fetchOrganizations(settings.tokenServerUrl).catch(() => {})
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
</script>

<template>
  <div class="grid grid-cols-1 gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
    <!-- 左ペイン: 団体一覧 -->
    <div>
      <h2 class="mb-2 text-[12px] font-medium">団体</h2>

      <p v-if="orgs.isForbidden" class="text-xs text-destructive">
        管理者権限がありません(adminUsers/&#123;uid&#125;.permissions に
        organizations:monitor が必要です)。
      </p>
      <p v-else-if="orgs.errorMessage" class="text-xs text-destructive">
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
          @click="selectOrg(org.orgId)"
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
      </template>
    </div>
  </div>
</template>
