<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useAdminRoomsStore } from '@/stores/adminRooms'
import { useAdminRecordingsStore } from '@/stores/adminRecordings'
import { useAdminOrganizationsStore } from '@/stores/adminOrganizations'
import { usePolling } from '@/composables/usePolling'
import { formatTime } from '@/lib/format'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const rooms = useAdminRoomsStore()
const recordings = useAdminRecordingsStore()
const orgs = useAdminOrganizationsStore()

const roomId = computed(() => String(route.params.roomId))

function load() {
  rooms.fetchRoomDetail(settings.tokenServerUrl, roomId.value).catch(() => {})
  // [Phase8] 録音履歴。GET /rooms/:roomId/recordings はメンバーであれば
  // 誰でも閲覧可(admin権限とは別モデル)。
  recordings.fetchRecordings(settings.tokenServerUrl, roomId.value).catch(() => {})
}

onMounted(() => {
  load()
  // [Phase11] 割り当て変更フォームのセレクトボックス用。organizations:monitor
  // 権限がない場合は403のままリストが空になり、フォーム自体が非表示になる。
  orgs.fetchOrganizations(settings.tokenServerUrl).catch(() => {})
})
watch(roomId, load)
// [Phase8] 詳細・録音履歴とも10秒ごとに再取得する。
usePolling(load)

onUnmounted(() => {
  recordings.clear()
})

function back() {
  rooms.clearDetail()
  recordings.clear()
  router.push({ name: 'rooms' })
}

/**
 * [Phase8] owner/moderator限定のGCS署名付きダウンロードURL(5分間有効)を
 * 発行してもらい、新しいタブで開く。一覧取得のエラー(recordings.errorMessage)
 * とは別に、発行操作自体の失敗もここに反映する。
 */
async function download(recordingId: string) {
  try {
    const url = await recordings.issueDownloadUrl(settings.tokenServerUrl, roomId.value, recordingId)
    window.open(url, '_blank')
  } catch (e) {
    recordings.errorMessage = (e as Error).message
  }
}

/**
 * 録音削除。取り消せない操作のため確認ダイアログを挟む。
 */
async function remove(recordingId: string) {
  if (!window.confirm('この録音を削除します。この操作は取り消せません。よろしいですか?')) {
    return
  }
  try {
    await recordings.deleteRecording(settings.tokenServerUrl, roomId.value, recordingId)
  } catch {
    // errorMessageはstore側で設定済み
  }
}

/** room/:roomId/settings/autoRecording のON/OFFを切り替える。 */
async function toggleAutoRecording() {
  if (!rooms.detail) return
  try {
    await rooms.setAutoRecording(settings.tokenServerUrl, roomId.value, !rooms.detail.settings.autoRecording)
  } catch {
    // errorMessageはstore側で設定済み
  }
}

// --- [Phase11] 組織階層への割り当て変更 ---

const assignOrgId = ref<string>('') // '' = 無所属
const assignNodeId = ref<string>('') // '' = 団体直下(node未指定)

// rooms.detail が読み込まれた(または別Roomへ切り替わった)タイミングで、
// フォームの初期値を現在の割り当てに合わせる。
watch(
  () => rooms.detail?.org.orgId,
  (orgId) => {
    assignOrgId.value = orgId ?? ''
    assignNodeId.value = rooms.detail?.org.breadcrumb.at(-1)?.nodeId ?? ''
    if (orgId && !orgs.nodesByOrgId.has(orgId)) {
      orgs.fetchNodes(settings.tokenServerUrl, orgId).catch(() => {})
    }
  },
  { immediate: true },
)

function onAssignOrgChange() {
  assignNodeId.value = ''
  if (assignOrgId.value && !orgs.nodesByOrgId.has(assignOrgId.value)) {
    orgs.fetchNodes(settings.tokenServerUrl, assignOrgId.value).catch(() => {})
  }
}

const assignNodeOptions = computed(() => orgs.nodesByOrgId.get(assignOrgId.value) ?? [])

async function saveAssignment() {
  try {
    await orgs.assignRoomOrg(
      settings.tokenServerUrl,
      roomId.value,
      assignOrgId.value || null,
      assignNodeId.value || null,
    )
    await rooms.fetchRoomDetail(settings.tokenServerUrl, roomId.value)
  } catch {
    // orgs.assignErrorMessage に反映済み
  }
}

// --- [Phase12] moderator任命/降格 ---
// owner/guest/banned済みは対象外(サーバー側でも同じガードをかけているが、
// UI側でも選択肢自体を出さないことで「押せるのに403になる」体験を避ける)。
function canChangeRole(member: { role: string; status: string }) {
  return member.role !== 'owner' && member.role !== 'guest' && member.status !== 'banned'
}

// 各行の「変更先」の選択状態。uid単位で持つ(rowごとに独立したselectのため)。
const roleDrafts = ref<Record<string, 'moderator' | 'member'>>({})

function roleDraftFor(uid: string, currentRole: string) {
  return roleDrafts.value[uid] ?? (currentRole === 'moderator' ? 'moderator' : 'member')
}

async function changeRole(targetUid: string) {
  const draft = roleDrafts.value[targetUid]
  if (!draft) return
  try {
    await rooms.setMemberRole(settings.tokenServerUrl, roomId.value, targetUid, draft)
  } catch {
    // rooms.roleErrorMessage に反映済み
  }
}
</script>

<template>
  <div class="p-5">
    <Button variant="secondary" size="sm" class="mb-4 w-auto" @click="back">← 一覧に戻る</Button>

    <p v-if="rooms.isForbidden" class="text-xs text-destructive">管理者権限がありません。</p>
    <p v-else-if="rooms.errorMessage" class="text-xs text-destructive">
      詳細の取得に失敗しました: {{ rooms.errorMessage }}
    </p>
    <p
      v-else-if="rooms.isLoadingDetail && !rooms.detail"
      class="text-xs text-muted-foreground"
    >
      読み込み中...
    </p>

    <template v-if="rooms.detail">
      <h2 class="mb-1 text-sm font-semibold">room: {{ rooms.detail.roomId }}</h2>
      <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span>owner={{ rooms.detail.ownerUid }}</span>
        <span>作成={{ formatTime(rooms.detail.createdAt) }}</span>
        <span>定員={{ rooms.detail.maxMembers ?? '—' }}</span>
        <Badge v-if="rooms.detail.recording.active" variant="destructive">録音中</Badge>
        <Badge v-if="rooms.detail.talkLock" variant="accent">発話中: {{ rooms.detail.talkLock.uid }}</Badge>
      </div>

      <h3 class="mb-2 text-[12px] font-medium">設定</h3>
      <div class="mb-6 flex items-center gap-3 text-xs">
        <span class="text-muted-foreground">自動録音</span>
        <button
          type="button"
          role="switch"
          :aria-checked="rooms.detail.settings.autoRecording"
          :disabled="rooms.isUpdatingAutoRecording"
          class="relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:pointer-events-none disabled:opacity-40"
          :class="rooms.detail.settings.autoRecording ? 'border-primary bg-primary/30' : 'border-border bg-white/5'"
          @click="toggleAutoRecording"
        >
          <span
            class="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-foreground transition-all"
            :class="rooms.detail.settings.autoRecording ? 'left-[18px]' : 'left-[3px]'"
          />
        </button>
        <Badge :variant="rooms.detail.settings.autoRecording ? 'accent' : 'default'">
          {{ rooms.detail.settings.autoRecording ? 'ON' : 'OFF' }}
        </Badge>
        <span v-if="rooms.isUpdatingAutoRecording" class="text-muted-foreground">更新中...</span>
      </div>

      <h3 class="mb-2 text-[12px] font-medium">組織</h3>
      <div class="mb-6">
        <div class="mb-2 text-xs">
          <template v-if="rooms.detail.org.orgId">
            <span>{{ rooms.detail.org.orgName }}</span>
            <template v-for="crumb in rooms.detail.org.breadcrumb" :key="crumb.nodeId">
              <span class="mx-1 text-muted-foreground">→</span>
              <span>{{ crumb.name }}</span>
            </template>
          </template>
          <span v-else class="text-muted-foreground">— 無所属 —</span>
        </div>

        <p v-if="orgs.isForbidden" class="text-[11px] text-muted-foreground">
          割り当てを変更するには organizations:monitor / organizations:manage 権限が必要です。
        </p>
        <div v-else class="flex flex-wrap items-center gap-2">
          <select
            v-model="assignOrgId"
            class="h-8 rounded-sm border border-input bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-primary"
            @change="onAssignOrgChange"
          >
            <option value="">(無所属)</option>
            <option v-for="org in orgs.organizations" :key="org.orgId" :value="org.orgId">
              {{ org.name }}
            </option>
          </select>
          <select
            v-model="assignNodeId"
            class="h-8 rounded-sm border border-input bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-primary disabled:opacity-40"
            :disabled="!assignOrgId"
          >
            <option value="">(団体直下)</option>
            <option v-for="node in assignNodeOptions" :key="node.nodeId" :value="node.nodeId">
              {{ '　'.repeat(node.depth) }}{{ node.name }}
            </option>
          </select>
          <Button size="sm" class="w-auto" :disabled="orgs.isAssigning" @click="saveAssignment">
            {{ orgs.isAssigning ? '更新中...' : '割り当てを保存' }}
          </Button>
        </div>
        <p v-if="orgs.assignErrorMessage" class="mt-1 text-[11px] text-destructive">
          {{ orgs.assignErrorMessage }}
        </p>
      </div>

      <h3 class="mb-2 text-[12px] font-medium">メンバー台帳(Firestore)</h3>
      <p v-if="rooms.roleErrorMessage" class="mb-2 text-[11px] text-destructive">
        {{ rooms.roleErrorMessage }}
      </p>
      <table class="mb-6 w-full border-collapse text-xs">
        <thead>
          <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <th class="p-2 text-left">UID</th>
            <th class="p-2 text-left">表示名</th>
            <th class="p-2 text-left">role</th>
            <th class="p-2 text-left">status</th>
            <th class="p-2 text-left">参加日時</th>
            <th class="p-2 text-left"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in rooms.detail.members" :key="m.uid" class="border-b border-border">
            <td class="max-w-[10rem] truncate p-2">{{ m.uid }}</td>
            <td class="p-2">{{ m.displayName }}</td>
            <td class="p-2">{{ m.role }}</td>
            <td class="p-2">
              <span :class="m.status === 'banned' ? 'text-destructive' : ''">{{ m.status }}</span>
            </td>
            <td class="whitespace-nowrap p-2">{{ formatTime(m.joinedAt) }}</td>
            <td class="p-2">
              <!-- [Phase12] owner/guest/BAN済みはrole変更対象外(canChangeRole参照)。
                   Room内owner専用API(rooms.js)を持たない代わりに、この画面から
                   rooms:manage権限でmoderator任命/降格ができるようにしている。 -->
              <div v-if="canChangeRole(m)" class="flex items-center gap-1.5">
                <select
                  :value="roleDraftFor(m.uid, m.role)"
                  class="h-7 rounded-sm border border-input bg-background px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-primary"
                  :disabled="rooms.updatingRoleUids.has(m.uid)"
                  @change="roleDrafts[m.uid] = ($event.target as HTMLSelectElement).value as 'moderator' | 'member'"
                >
                  <option value="member">member</option>
                  <option value="moderator">moderator</option>
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  class="h-7 w-auto px-2 text-[11px]"
                  :disabled="rooms.updatingRoleUids.has(m.uid) || roleDraftFor(m.uid, m.role) === m.role"
                  @click="changeRole(m.uid)"
                >
                  {{ rooms.updatingRoleUids.has(m.uid) ? '変更中...' : '変更' }}
                </Button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 class="mb-2 text-[12px] font-medium">現在の接続(LiveKit)</h3>
      <table class="mb-6 w-full border-collapse text-xs">
        <thead>
          <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <th class="p-2 text-left">identity</th>
            <th class="p-2 text-left">接続日時</th>
            <th class="p-2 text-left">状態</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rooms.detail.liveParticipants.length === 0">
            <td colspan="3" class="p-2 text-muted-foreground">— 現在接続なし —</td>
          </tr>
          <tr v-for="p in rooms.detail.liveParticipants" :key="p.identity" class="border-b border-border">
            <td class="max-w-[10rem] truncate p-2">{{ p.identity }}</td>
            <td class="whitespace-nowrap p-2">{{ formatTime(p.joinedAt) }}</td>
            <td class="p-2">{{ p.isPublishingAudio ? '送話中' : '—' }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="mb-2 text-[12px] font-medium">録音履歴</h3>
      <p v-if="recordings.errorMessage" class="mb-2 text-xs text-destructive">{{ recordings.errorMessage }}</p>
      <p
        v-else-if="recordings.isLoading && recordings.recordings.length === 0"
        class="mb-2 text-xs text-muted-foreground"
      >
        読み込み中...
      </p>
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <th class="p-2 text-left">egressId</th>
            <th class="p-2 text-left">開始</th>
            <th class="p-2 text-left">終了</th>
            <th class="p-2 text-left">状態</th>
            <th class="p-2 text-left"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="recordings.recordings.length === 0">
            <td colspan="5" class="p-2 text-muted-foreground">— 録音履歴なし —</td>
          </tr>
          <tr v-for="r in recordings.recordings" :key="r.recordingId" class="border-b border-border">
            <td class="max-w-[10rem] truncate p-2">{{ r.recordingId }}</td>
            <td class="whitespace-nowrap p-2">{{ formatTime(r.startedAt) }}</td>
            <td class="whitespace-nowrap p-2">{{ formatTime(r.endedAt) }}</td>
            <td class="p-2">{{ r.status }}</td>
            <td class="p-2">
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="text-[11px] text-primary underline-offset-2 hover:underline"
                  @click="download(r.recordingId)"
                >
                  ダウンロードURL発行
                </button>
                <button
                  type="button"
                  class="text-[11px] text-destructive underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-40"
                  :disabled="recordings.deletingIds.has(r.recordingId)"
                  @click="remove(r.recordingId)"
                >
                  {{ recordings.deletingIds.has(r.recordingId) ? '削除中...' : '削除' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
