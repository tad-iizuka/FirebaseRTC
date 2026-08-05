<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useAdminRoomsStore } from '@/stores/adminRooms'
import { usePolling } from '@/composables/usePolling'
import { formatTime } from '@/lib/format'
import { resolveScheduleState, scheduleStateLabel, scheduleStateBadgeVariant } from '@/lib/roomSchedule'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import { cn } from '@/lib/utils'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const rooms = useAdminRoomsStore()

onMounted(() => {
  rooms.goToFirstPage(settings.tokenServerUrl).catch(() => {})
})

// [Phase8] 表示中のページを10秒ごとに再取得する簡易リアルタイム更新。
// 「次のページ」への遷移状態(cursor)は保ったまま、内容だけを更新する。
usePolling(() => {
  rooms.refreshCurrentPage(settings.tokenServerUrl).catch(() => {})
})

// [Phase11] OrganizationsView.vue の「このnode配下のRoomを見る」から
// ?orgId=&nodeId= 付きで遷移してきた場合のクライアント側フィルタ。
//
// [既知の制約] GET /admin/rooms は現状orgId/nodeIdでのサーバー側フィルタに
// 対応していないため、これは「今読み込まれているページの中だけ」を絞り込む
// 簡易フィルタである。団体・拠点配下のRoom数がページサイズ(デフォルト50件)を
// 超える場合、次ページ以降は自動では絞り込まれない(「次のページ」ボタンで
// 読み込んだ分だけフィルタが効く)。サーバー側フィルタ(GET /admin/rooms?
// orgId=&nodeId=)が必要になった場合は別途追加する。
const filterOrgId = computed(() => (typeof route.query.orgId === 'string' ? route.query.orgId : null))
const filterNodeId = computed(() => (typeof route.query.nodeId === 'string' ? route.query.nodeId : null))
const isFiltering = computed(() => !!filterOrgId.value)

const filteredRooms = computed(() => {
  if (!filterOrgId.value) return rooms.rooms
  return rooms.rooms.filter((room) => {
    if (room.orgId !== filterOrgId.value) return false
    if (!filterNodeId.value) return true
    // 選択したnode自身、またはその配下(nodeAncestorIdsに含まれる)のRoomを対象にする
    return room.nodeId === filterNodeId.value || room.nodeAncestorIds.includes(filterNodeId.value)
  })
})

function clearFilter() {
  router.push({ name: 'rooms' })
}

function refresh() {
  rooms.goToFirstPage(settings.tokenServerUrl).catch(() => {})
}
function nextPage() {
  rooms.goToNextPage(settings.tokenServerUrl).catch(() => {})
}
function openRoom(roomId: string) {
  router.push({ name: 'room-detail', params: { roomId } })
}

// --- [ルーム作成のadmin-dashboard移管] ルーム新規作成フォーム ---
// rooms:create権限が無い場合は送信時に403となり、rooms.createRoomErrorMessage
// に反映される(他の画面と同じ「事前チェックせず、失敗して初めてわかる」方針。
// admin-dashboardの事前権限チェック要否は次アクション項目として別途検討中)。
const newRoomName = ref('')
const newRoomMaxMembers = ref('')

async function handleCreateRoom() {
  if (!newRoomName.value.trim()) return
  try {
    const maxMembers = newRoomMaxMembers.value.trim() ? Number(newRoomMaxMembers.value.trim()) : undefined
    await rooms.createRoom(settings.tokenServerUrl, newRoomName.value.trim(), maxMembers)
    newRoomName.value = ''
    newRoomMaxMembers.value = ''
  } catch {
    // rooms.createRoomErrorMessage に反映済み
  }
}

function dismissCreatedRoom() {
  rooms.clearLastCreatedRoom()
}
</script>

<template>
  <div class="p-5">
    <!-- [2026-08-02追加] 権限がない場合はエラーのみを表示し、新規作成フォームや
         テーブル等は出さない(見えていても叩けば403になるだけのため)。 -->
    <p v-if="rooms.isForbidden" class="text-xs text-destructive">
      管理者権限がありません。
    </p>
    <template v-else>
      <div class="mb-4 flex items-center gap-2">
        <Input v-model="settings.tokenServerUrl" class="max-w-md" />
        <Button variant="secondary" size="sm" class="w-auto" @click="refresh">再読み込み</Button>
      </div>

      <!-- [ルーム作成のadmin-dashboard移管] -->
      <!-- [2026-08-02追加, item6] isForbiddenは初回フェッチが完了するまでfalseの
           ままなので、isLoadingList中は未確定のまま表示しない。読み込み完了後、
           isForbiddenがtrueならこのtemplate自体がv-elseで非表示になる。 -->
      <div
        v-if="!(rooms.isLoadingList && rooms.rooms.length === 0)"
        class="mb-5 grid max-w-md gap-2 rounded-sm border border-dashed border-border p-3"
      >
        <h3 class="text-[11px] font-medium text-muted-foreground">ルームを新規作成</h3>
        <p class="text-[11px] text-muted-foreground">
          作成には rooms:create 権限が必要です(付与は「管理者権限」タブから)。
        </p>
        <Input v-model="newRoomName" placeholder="ルーム名(例: 〇〇現場 巡回班)" />
        <Input v-model="newRoomMaxMembers" placeholder="定員(任意, 数値)" />
        <Button size="sm" class="w-auto" :disabled="rooms.isCreatingRoom" @click="handleCreateRoom">
          {{ rooms.isCreatingRoom ? '作成中...' : 'ルームを作成' }}
        </Button>
        <p v-if="rooms.createRoomErrorMessage" class="text-xs text-destructive">
          {{ rooms.createRoomErrorMessage }}
        </p>
        <div
          v-if="rooms.lastCreatedRoom"
          class="mt-1 grid gap-1 rounded-sm border border-dashed border-primary bg-background p-2.5 text-[12px]"
        >
          <span
            >「{{ rooms.lastCreatedRoom.name }}」を作成しました(roomId={{
              rooms.lastCreatedRoom.roomId
            }})</span
          >
          <span>招待コード(この画面を離れてもRoom詳細画面から常に再確認できます。参加者に共有してください):</span>
          <span class="text-lg tracking-[0.15em] text-primary">{{ rooms.lastCreatedRoom.inviteCode }}</span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-[11px] text-primary underline-offset-2 hover:underline"
              @click="openRoom(rooms.lastCreatedRoom.roomId)"
            >
              このルームの詳細を開く →
            </button>
            <button
              type="button"
              class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              @click="dismissCreatedRoom"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>

      <div v-if="isFiltering" class="mb-4 flex items-center gap-2 text-xs">
        <Badge variant="accent">
          絞り込み中: orgId={{ filterOrgId }}<template v-if="filterNodeId">, nodeId={{ filterNodeId }}</template>
        </Badge>
        <button type="button" class="text-primary underline-offset-2 hover:underline" @click="clearFilter">
          解除
        </button>
        <span class="text-[11px] text-muted-foreground">
          (現在読み込み済みのページ内のみを絞り込んでいます。次のページで対象が増える場合があります)
        </span>
      </div>

      <p v-if="rooms.errorMessage" class="text-xs text-destructive">
        ルーム一覧の取得に失敗しました: {{ rooms.errorMessage }}
      </p>
      <p
        v-else-if="rooms.isLoadingList && rooms.rooms.length === 0"
        class="text-xs text-muted-foreground"
      >
        読み込み中...
      </p>
      <p
        v-else-if="isFiltering && filteredRooms.length === 0 && !rooms.isLoadingList"
        class="text-xs text-muted-foreground"
      >
        この条件に一致するRoomは、読み込み済みのページ内には見つかりませんでした。
      </p>

      <table v-if="filteredRooms.length" class="w-full border-collapse text-xs">
        <thead>
          <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <th class="p-2 text-left"></th>
            <th class="p-2 text-left">Room名</th>
            <th class="p-2 text-left">Room ID</th>
            <th class="p-2 text-left">Owner UID</th>
            <th class="p-2 text-left">所属(orgId)</th>
            <th class="p-2 text-left">作成日時</th>
            <th class="p-2 text-left">接続中人数</th>
            <th class="p-2 text-left">メンバー数(active)</th>
            <th class="p-2 text-left">状態</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="room in filteredRooms"
            :key="room.roomId"
            class="cursor-pointer border-b border-border hover:bg-white/5"
            @click="openRoom(room.roomId)"
          >
            <td class="p-2">
              <span
                :class="
                  cn(
                    'inline-block h-[7px] w-[7px] rounded-full bg-muted-foreground',
                    room.live.isLive && 'bg-live shadow-[0_0_6px_hsl(var(--live))]',
                  )
                "
              />
            </td>
            <td class="max-w-[12rem] truncate p-2">{{ room.name ?? '—' }}</td>
            <td class="whitespace-nowrap p-2">{{ room.roomId }}</td>
            <td class="max-w-[10rem] truncate p-2">{{ room.ownerUid }}</td>
            <td class="max-w-[8rem] truncate p-2 text-muted-foreground">{{ room.orgId ?? '—' }}</td>
            <td class="whitespace-nowrap p-2">{{ formatTime(room.createdAt) }}</td>
            <td class="p-2">{{ room.live.numParticipants }}</td>
            <td class="p-2">{{ room.activeMemberCount ?? '—' }}</td>
            <td class="p-2">
              <div class="flex flex-wrap gap-1">
                <Badge v-if="room.recording.active" variant="destructive">録音中</Badge>
                <Badge v-if="room.talkLock" variant="accent">発話中: {{ room.talkLock.uid }}</Badge>
                <Badge
                  v-if="resolveScheduleState(room.schedule) !== 'in_session'"
                  :variant="scheduleStateBadgeVariant(resolveScheduleState(room.schedule))"
                >
                  {{ scheduleStateLabel(resolveScheduleState(room.schedule)) }}
                </Badge>
                <span
                  v-if="!room.recording.active && !room.talkLock && resolveScheduleState(room.schedule) === 'in_session'"
                  class="text-muted-foreground"
                  >—</span
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <Button
        v-if="rooms.nextCursor"
        variant="secondary"
        size="sm"
        class="mt-3 w-auto"
        @click="nextPage"
      >
        次のページ
      </Button>
    </template>
  </div>
</template>
