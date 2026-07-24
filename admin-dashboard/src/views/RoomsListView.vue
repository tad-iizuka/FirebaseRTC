<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useAdminRoomsStore } from '@/stores/adminRooms'
import { usePolling } from '@/composables/usePolling'
import { formatTime } from '@/lib/format'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import { cn } from '@/lib/utils'

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

function refresh() {
  rooms.goToFirstPage(settings.tokenServerUrl).catch(() => {})
}
function nextPage() {
  rooms.goToNextPage(settings.tokenServerUrl).catch(() => {})
}
function openRoom(roomId: string) {
  router.push({ name: 'room-detail', params: { roomId } })
}
</script>

<template>
  <div class="p-5">
    <div class="mb-4 flex items-center gap-2">
      <Input v-model="settings.tokenServerUrl" class="max-w-md" />
      <Button variant="secondary" size="sm" class="w-auto" @click="refresh">再読み込み</Button>
    </div>

    <p v-if="rooms.isForbidden" class="text-xs text-destructive">
      管理者権限がありません(adminUsers/&#123;uid&#125;.permissions に rooms:monitor が必要です)。
    </p>
    <p v-else-if="rooms.errorMessage" class="text-xs text-destructive">
      ルーム一覧の取得に失敗しました: {{ rooms.errorMessage }}
    </p>
    <p
      v-else-if="rooms.isLoadingList && rooms.rooms.length === 0"
      class="text-xs text-muted-foreground"
    >
      読み込み中...
    </p>

    <table v-if="rooms.rooms.length" class="w-full border-collapse text-xs">
      <thead>
        <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          <th class="p-2 text-left"></th>
          <th class="p-2 text-left">Room ID</th>
          <th class="p-2 text-left">Owner UID</th>
          <th class="p-2 text-left">作成日時</th>
          <th class="p-2 text-left">接続中人数</th>
          <th class="p-2 text-left">メンバー数(active)</th>
          <th class="p-2 text-left">状態</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="room in rooms.rooms"
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
          <td class="whitespace-nowrap p-2">{{ room.roomId }}</td>
          <td class="max-w-[10rem] truncate p-2">{{ room.ownerUid }}</td>
          <td class="whitespace-nowrap p-2">{{ formatTime(room.createdAt) }}</td>
          <td class="p-2">{{ room.live.numParticipants }}</td>
          <td class="p-2">{{ room.activeMemberCount ?? '—' }}</td>
          <td class="p-2">
            <div class="flex flex-wrap gap-1">
              <Badge v-if="room.recording.active" variant="destructive">録音中</Badge>
              <Badge v-if="room.talkLock" variant="accent">発話中: {{ room.talkLock.uid }}</Badge>
              <span v-if="!room.recording.active && !room.talkLock" class="text-muted-foreground">—</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <Button v-if="rooms.nextCursor" variant="secondary" size="sm" class="mt-3 w-auto" @click="nextPage">
      次のページ
    </Button>
  </div>
</template>
