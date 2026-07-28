<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ConnectionStatusIcon from '@/components/ConnectionStatusIcon.vue'
import LoginStatusIcon from '@/components/LoginStatusIcon.vue'
import type { ConnectionStatusKind } from '@/stores/connection'

const { t } = useI18n()
defineProps<{
  userName?: string | null
  photoUrl?: string | null
  isSignedIn: boolean
  connectionStatusKind: ConnectionStatusKind
  roomId: string | null
}>()
const emit = defineEmits<{ signOut: [] }>()
</script>

<template>
  <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
    <span class="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{{ t('header.appName') }}</span>
    <div class="flex items-center gap-2">
      <ConnectionStatusIcon :status-kind="connectionStatusKind" :room-id="roomId" />
      <LoginStatusIcon
        :photo-url="photoUrl"
        :display-name="userName"
        :is-signed-in="isSignedIn"
        @sign-out="emit('signOut')"
      />
    </div>
  </div>
</template>
