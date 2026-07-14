<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useAdminUsersStore } from '@/stores/adminUsers'
import { usePolling } from '@/composables/usePolling'
import { formatTime } from '@/lib/format'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const settings = useSettingsStore()
const adminUsers = useAdminUsersStore()

const targetUid = ref('')
const targetPermission = ref('')

function load() {
  adminUsers.fetchAdmins(settings.tokenServerUrl).catch(() => {})
}

onMounted(load)
usePolling(load)

async function grant() {
  if (!targetUid.value.trim() || !targetPermission.value.trim()) return
  try {
    await adminUsers.changePermission(
      settings.tokenServerUrl,
      targetUid.value.trim(),
      targetPermission.value.trim(),
      'grant',
    )
  } catch {
    // adminUsers.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}

async function revoke() {
  if (!targetUid.value.trim() || !targetPermission.value.trim()) return
  try {
    await adminUsers.changePermission(
      settings.tokenServerUrl,
      targetUid.value.trim(),
      targetPermission.value.trim(),
      'revoke',
    )
  } catch {
    // adminUsers.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}
</script>

<template>
  <div class="p-5">
    <p v-if="adminUsers.isForbidden" class="text-xs text-destructive">
      管理者権限がありません(adminUsers/&#123;uid&#125;.permissions に admins:manage が必要です)。
    </p>
    <p v-else-if="adminUsers.errorMessage" class="text-xs text-destructive">{{ adminUsers.errorMessage }}</p>
    <p v-else-if="adminUsers.isLoading" class="text-xs text-muted-foreground">読み込み中...</p>

    <table v-if="adminUsers.admins.length" class="mb-6 w-full border-collapse text-xs">
      <thead>
        <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          <th class="p-2 text-left">UID</th>
          <th class="p-2 text-left">permissions</th>
          <th class="p-2 text-left">付与日時</th>
          <th class="p-2 text-left">メモ</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in adminUsers.admins" :key="a.uid" class="border-b border-border">
          <td class="max-w-[12rem] truncate p-2">{{ a.uid }}</td>
          <td class="p-2">{{ a.permissions.join(', ') || '—' }}</td>
          <td class="whitespace-nowrap p-2">{{ formatTime(a.grantedAt) }}</td>
          <td class="p-2 text-muted-foreground">{{ a.note ?? '—' }}</td>
        </tr>
      </tbody>
    </table>
    <p
      v-else-if="!adminUsers.isLoading && !adminUsers.isForbidden && !adminUsers.errorMessage"
      class="mb-6 text-xs text-muted-foreground"
    >
      — 管理者なし —
    </p>

    <div class="grid max-w-md gap-2">
      <Input v-model="targetUid" placeholder="対象UID" />
      <Input v-model="targetPermission" placeholder="permission (例: audit:read)" />
      <div class="flex gap-2">
        <Button size="sm" class="w-auto" @click="grant">付与</Button>
        <Button variant="secondary" size="sm" class="w-auto" @click="revoke">剥奪</Button>
      </div>
    </div>
    <p class="mt-3 max-w-md text-[11px] text-muted-foreground">
      admins:manage 自体はこの画面から付与/剥奪できません
      (dev-tools/grant-admin-permission.js での手動運用に固定しています)。
    </p>
  </div>
</template>
