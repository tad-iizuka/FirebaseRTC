<script setup lang="ts">
import { onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useAdminAuditLogsStore } from '@/stores/adminAuditLogs'
import { usePolling } from '@/composables/usePolling'
import { formatTime } from '@/lib/format'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const settings = useSettingsStore()
const auditLogs = useAdminAuditLogsStore()

function load() {
  auditLogs.applyFilters(settings.tokenServerUrl).catch(() => {})
}

onMounted(load)
// [Phase8] 表示中は10秒ごとに現在のフィルタ条件で再取得する。
usePolling(load)

function nextPage() {
  auditLogs.goToNextPage(settings.tokenServerUrl).catch(() => {})
}
</script>

<template>
  <div class="p-5">
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <Input v-model="auditLogs.roomIdFilter" placeholder="roomIdで絞込(任意)" class="max-w-[220px]" />
      <Input v-model="auditLogs.actorUidFilter" placeholder="actorUidで絞込(任意)" class="max-w-[220px]" />
      <Button variant="secondary" size="sm" class="w-auto" @click="load">絞込</Button>
    </div>

    <p v-if="auditLogs.isForbidden" class="text-xs text-destructive">
      管理者権限がありません(adminUsers/&#123;uid&#125;.permissions に audit:read が必要です)。
    </p>
    <p v-else-if="auditLogs.errorMessage" class="text-xs text-destructive">
      監査ログの取得に失敗しました: {{ auditLogs.errorMessage }}
    </p>
    <p v-else-if="auditLogs.isLoading" class="text-xs text-muted-foreground">読み込み中...</p>

    <table v-if="auditLogs.logs.length" class="w-full border-collapse text-xs">
      <thead>
        <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          <th class="p-2 text-left">日時</th>
          <th class="p-2 text-left">action</th>
          <th class="p-2 text-left">actor</th>
          <th class="p-2 text-left">room</th>
          <th class="p-2 text-left">target</th>
          <th class="p-2 text-left">detail</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in auditLogs.logs" :key="log.logId" class="border-b border-border">
          <td class="whitespace-nowrap p-2">{{ formatTime(log.createdAt) }}</td>
          <td class="p-2">{{ log.action }}</td>
          <td class="max-w-[10rem] truncate p-2">{{ log.actorUid }}</td>
          <td class="p-2">{{ log.targetRoomId ?? '—' }}</td>
          <td class="max-w-[10rem] truncate p-2">{{ log.targetUid ?? '—' }}</td>
          <td class="max-w-[16rem] truncate p-2 text-muted-foreground">{{ JSON.stringify(log.detail) }}</td>
        </tr>
      </tbody>
    </table>
    <p
      v-else-if="!auditLogs.isLoading && !auditLogs.isForbidden && !auditLogs.errorMessage"
      class="text-xs text-muted-foreground"
    >
      — 記録なし —
    </p>

    <Button v-if="auditLogs.nextCursor" variant="secondary" size="sm" class="mt-3 w-auto" @click="nextPage">
      次のページ
    </Button>
  </div>
</template>
