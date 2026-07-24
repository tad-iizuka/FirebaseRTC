<script setup lang="ts">
import { computed } from 'vue'
import { useAdminRoomsStore } from '@/stores/adminRooms'
import { useAdminRecordingsStore } from '@/stores/adminRecordings'
import { useAdminAuditLogsStore } from '@/stores/adminAuditLogs'
import { useAdminUsersStore } from '@/stores/adminUsers'

defineProps<{ userName?: string | null }>()
const emit = defineEmits<{ signOut: [] }>()

// [読み込み中インジケータ] 各storeのisLoadingを集約し、ヘッダー下端に固定位置の
// 細いプログレスバーとして表示する。position: absoluteでドキュメントフローから
// 外しているため、10秒ごとのポーリングで出たり消えたりしても他の要素が
// 上下に動かない。
const rooms = useAdminRoomsStore()
const recordings = useAdminRecordingsStore()
const auditLogs = useAdminAuditLogsStore()
const adminUsers = useAdminUsersStore()

const isLoading = computed(
  () =>
    rooms.isLoadingList ||
    rooms.isLoadingDetail ||
    recordings.isLoading ||
    auditLogs.isLoading ||
    adminUsers.isLoading,
)
</script>

<template>
  <div class="relative flex items-center justify-between border-b border-border px-5 py-3.5">
    <span class="text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
      >PTT 管理者ダッシュボード</span
    >
    <div v-if="userName" class="flex items-center gap-2">
      <span class="max-w-[10rem] truncate text-xs">{{ userName }}</span>
      <button
        type="button"
        class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        @click="emit('signOut')"
      >
        サインアウト
      </button>
    </div>

    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-transparent"
      aria-hidden="true"
    >
      <div
        class="h-full w-full origin-left bg-primary transition-opacity duration-150"
        :class="isLoading ? 'opacity-100 animate-pulse' : 'opacity-0'"
      />
    </div>
  </div>
</template>
