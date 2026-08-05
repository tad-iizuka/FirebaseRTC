<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useAdminRoomsStore } from '@/stores/adminRooms'
import { useAdminRecordingsStore } from '@/stores/adminRecordings'
import { useAdminOrganizationsStore } from '@/stores/adminOrganizations'
import { useAdminBadgesStore } from '@/stores/adminBadges'
import { usePolling } from '@/composables/usePolling'
import { formatTime } from '@/lib/format'
import { resolveScheduleState, scheduleStateLabel, scheduleStateBadgeVariant } from '@/lib/roomSchedule'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const rooms = useAdminRoomsStore()
const recordings = useAdminRecordingsStore()
const orgs = useAdminOrganizationsStore()
const badges = useAdminBadgesStore()

const roomId = computed(() => String(route.params.roomId))

function load() {
  rooms.fetchRoomDetail(settings.tokenServerUrl, roomId.value).catch(() => {})
  // [Phase8] 録音履歴。GET /rooms/:roomId/recordings はメンバーであれば
  // 誰でも閲覧可(admin権限とは別モデル)。
  recordings.fetchRecordings(settings.tokenServerUrl, roomId.value).catch(() => {})
  // [Phase13] バッジ。badges:monitor権限がない場合は403のままテーブル側の
  // バッジ列が空表示になる(組織割り当てフォームと同じ扱い)。
  badges.fetchRoomBadges(settings.tokenServerUrl, roomId.value).catch(() => {})
}

onMounted(() => {
  load()
  // [Phase11] 割り当て変更フォームのセレクトボックス用。organizations:monitor
  // 権限がない場合は403のままリストが空になり、フォーム自体が非表示になる。
  orgs.fetchOrganizations(settings.tokenServerUrl).catch(() => {})
})
watch(roomId, () => {
  // [招待コードのadmin-dashboard移管] loadは10秒ポーリングにも使われる共通関数
  // のため、ここでは分けて「別Roomへ切り替わった時だけ」リセットする
  // (ポーリングのたびにリセットすると表示中のコードがちらつくため)。
  rooms.clearInviteCode()
  load()
})
// [Phase8] 詳細・録音履歴とも10秒ごとに再取得する。
usePolling(load)

onUnmounted(() => {
  recordings.clear()
  badges.clearRoomBadges()
  rooms.clearInviteCode()
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

// --- [Phase13] バッジ(読み取り専用) ---
// [2026-07-27] 付与/剥奪はUsersView.vue/UserDetailView.vue(ユーザー管理画面)
// に一本化した(badgeGrantsがRoomに紐付かないユーザー単位のレコードである
// ため、Room詳細画面から操作するのは不自然というユーザー指摘を受けての変更)。
// この画面では「このRoomの現在のメンバーが何を持っているか」を見るだけに
// とどめ、実際の付与/剥奪操作はユーザープロフィール画面へのリンクへ委ねる。
function badgesFor(uid: string) {
  return badges.roomBadges[uid]?.badges ?? []
}

function openUserProfile(uid: string) {
  router.push({ name: 'user-detail', params: { uid } })
}

// --- [ルーム名] admin-dashboardからの名称変更 ---
const nameDraft = ref('')
watch(
  () => rooms.detail?.roomId,
  () => {
    nameDraft.value = rooms.detail?.name ?? ''
  },
  { immediate: true },
)

async function saveName() {
  if (!rooms.detail) return
  const trimmed = nameDraft.value.trim()
  try {
    await rooms.updateRoomName(settings.tokenServerUrl, roomId.value, trimmed)
  } catch {
    // rooms.nameErrorMessage に反映済み
  }
}

// --- [開始/終了時刻] admin-dashboardからの設定・変更(rooms:manage権限) ---
// <input type="datetime-local">はローカルタイムゾーンでの
// "YYYY-MM-DDTHH:mm"形式を扱うため、ミリ秒との相互変換をここで行う。
// 空文字は「未設定(null) = 開始時刻なし即入室可 / 終了時刻なし無期限」。
function msToDatetimeLocal(ms: number | null): string {
  if (ms === null) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function datetimeLocalToMs(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

const scheduleStartDraft = ref('')
const scheduleEndDraft = ref('')
watch(
  () => rooms.detail?.roomId,
  () => {
    scheduleStartDraft.value = msToDatetimeLocal(rooms.detail?.schedule.start ?? null)
    scheduleEndDraft.value = msToDatetimeLocal(rooms.detail?.schedule.end ?? null)
  },
  { immediate: true },
)

// [開始/終了時刻] 状態判定・表示ラベルは src/lib/roomSchedule.ts に共通化
// (RoomsListView.vueと同じロジックを使う)。
async function saveSchedule() {
  if (!rooms.detail) return
  const start = datetimeLocalToMs(scheduleStartDraft.value)
  const end = datetimeLocalToMs(scheduleEndDraft.value)
  try {
    await rooms.updateSchedule(settings.tokenServerUrl, roomId.value, { start, end })
  } catch {
    // rooms.scheduleErrorMessage に反映済み
  }
}

// --- [招待コードのadmin-dashboard移管] ---
// 以前はptt-clientの入室後画面(InviteBox.vue)に表示していたが、それは
// 「入室に使ったコードをその場で覚えている」だけの表示で、以降は誰も
// 確認できなかった(brushup-plan.md 5.4「招待コードの可視範囲」参照)。
// GET /admin/rooms/:roomId/invite-code(rooms:manage権限)で常に確認できる
// ようにしたが、閲覧自体が監査ログに記録される(token-server側)ため、
// 画面を開いただけの10秒ポーリングでは呼ばず、「表示」ボタン押下時にだけ
// 明示的に呼び出す(録音のダウンロードURL発行と同じ設計)。
async function revealInviteCode() {
  try {
    await rooms.revealInviteCode(settings.tokenServerUrl, roomId.value)
  } catch {
    // rooms.inviteCodeErrorMessage / inviteCodeForbidden に反映済み
  }
}

const inviteCodeCopied = ref(false)
async function copyInviteCode() {
  if (!rooms.inviteCode) return
  try {
    await navigator.clipboard.writeText(rooms.inviteCode)
    inviteCodeCopied.value = true
    setTimeout(() => {
      inviteCodeCopied.value = false
    }, 1500)
  } catch {
    // クリップボードAPI非対応環境では無視(表示自体は見えているためコピー不可でも致命的ではない)
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

      <!-- [ルーム名] admin-dashboardから変更可能(rooms:manage権限)。 -->
      <div class="mb-2 flex items-center gap-2">
        <Input v-model="nameDraft" placeholder="(ルーム名未設定)" class="max-w-xs" />
        <Button
          size="sm"
          class="w-auto"
          :disabled="rooms.isUpdatingName || nameDraft.trim() === (rooms.detail.name ?? '')"
          @click="saveName"
        >
          {{ rooms.isUpdatingName ? '保存中...' : '名前を保存' }}
        </Button>
      </div>
      <p v-if="rooms.nameErrorMessage" class="mb-2 text-[11px] text-destructive">
        {{ rooms.nameErrorMessage }}
      </p>

      <!-- [招待コードのadmin-dashboard移管] 「表示」を押すたびに監査ログへ記録される
           (token-server/routes/admin.js GET .../invite-code)ため、常時表示ではなく
           明示的な操作でのみ取得する。 -->
      <div class="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span class="text-muted-foreground">招待コード</span>
        <span v-if="rooms.inviteCode" class="text-lg tracking-[0.15em] text-primary">{{
          rooms.inviteCode
        }}</span>
        <span v-else-if="rooms.inviteCodeForbidden" class="text-muted-foreground">
          確認するには rooms:manage 権限が必要です
        </span>
        <Button
          v-else
          size="sm"
          variant="secondary"
          class="h-7 w-auto px-2 text-[11px]"
          :disabled="rooms.isRevealingInviteCode"
          @click="revealInviteCode"
        >
          {{ rooms.isRevealingInviteCode ? '取得中...' : '招待コードを表示' }}
        </Button>
        <Button
          v-if="rooms.inviteCode"
          size="sm"
          variant="secondary"
          class="h-7 w-auto px-2 text-[11px]"
          @click="copyInviteCode"
        >
          {{ inviteCodeCopied ? 'コピーしました' : 'コピー' }}
        </Button>
      </div>
      <p v-if="rooms.inviteCodeErrorMessage" class="mb-2 text-[11px] text-destructive">
        {{ rooms.inviteCodeErrorMessage }}
      </p>

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

      <!-- [開始/終了時刻] rooms:manage権限で設定・変更する(Room内owner向けの経路は用意しない)。
           空欄=開始時刻なし(即入室可)/終了時刻なし(無期限)。 -->
      <h3 class="mb-2 text-[12px] font-medium">
        開始/終了時刻
        <Badge class="ml-1" :variant="scheduleStateBadgeVariant(resolveScheduleState(rooms.detail.schedule))">
          {{ scheduleStateLabel(resolveScheduleState(rooms.detail.schedule)) }}
        </Badge>
      </h3>
      <div class="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span class="text-muted-foreground">開始</span>
        <input
          v-model="scheduleStartDraft"
          type="datetime-local"
          class="h-8 rounded border border-border bg-white/5 px-2 text-xs"
        />
        <span class="text-muted-foreground">終了</span>
        <input
          v-model="scheduleEndDraft"
          type="datetime-local"
          class="h-8 rounded border border-border bg-white/5 px-2 text-xs"
        />
        <Button size="sm" class="w-auto" :disabled="rooms.isUpdatingSchedule" @click="saveSchedule">
          {{ rooms.isUpdatingSchedule ? '保存中...' : '保存' }}
        </Button>
      </div>
      <p class="mb-2 text-[11px] text-muted-foreground">
        両方空欄のままにすると、即入室可・無期限のルームになります。
        終了時刻を過ぎると新規入室者を含め全員が「チャット閲覧のみ」の状態になり、
        接続中の参加者は自動的に退出されます。
      </p>
      <p v-if="rooms.scheduleErrorMessage" class="mb-6 text-[11px] text-destructive">
        {{ rooms.scheduleErrorMessage }}
      </p>
      <div v-else class="mb-6"></div>

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

        <!-- [2026-08-02 修正] 以前はisForbiddenのみで出し分けており、
             isForbiddenの初期値がfalseのため、fetchOrganizations()が
             403で解決するまでの間、選択フォームが一瞬表示されてから
             消えるちらつきが発生していた(他画面のisLoading&&list.length===0
             という定番パターンから外れていた)。ローディング中は
             フォームを出さない分岐を先頭に追加して解消する。 -->
        <p
          v-if="orgs.isLoadingOrganizations && orgs.organizations.length === 0 && !orgs.isForbidden"
          class="text-[11px] text-muted-foreground"
        >
          確認中...
        </p>
        <p v-else-if="orgs.isForbidden" class="text-[11px] text-muted-foreground">
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
      <p v-if="badges.isRoomBadgesForbidden" class="mb-2 text-[11px] text-muted-foreground">
        バッジ情報を見るには badges:monitor 権限が必要です。
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
            <th class="p-2 text-left">バッジ</th>
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
            <td class="p-2">
              <!-- [2026-07-27] 読み取り専用表示のみ。付与/剥奪は
                   ユーザープロフィール画面(users:monitor + badges:manage)
                   から行う(バッジがRoomに紐付かないユーザー単位の概念で
                   あるため。brushup-plan.md参照)。 -->
              <div class="mb-1 flex flex-wrap items-center gap-1">
                <span
                  v-for="assigned in badgesFor(m.uid)"
                  :key="assigned.badgeId"
                  class="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px]"
                  :title="assigned.name"
                >
                  <span>{{ assigned.icon }}</span>
                  <span>{{ assigned.name }}</span>
                </span>
                <span v-if="badgesFor(m.uid).length === 0" class="text-[11px] text-muted-foreground">—</span>
              </div>
              <button
                v-if="m.role !== 'guest'"
                type="button"
                class="text-[11px] text-primary underline-offset-2 hover:underline"
                @click="openUserProfile(m.uid)"
              >
                ユーザー管理で編集 →
              </button>
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
