<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
defineProps<{
  inviteCode: string | null
  roomId: string | null
}>()
</script>

<template>
  <div
    v-if="inviteCode && roomId"
    class="mx-5 my-3 grid gap-1.5 rounded-sm border border-dashed border-primary bg-background p-2.5 text-[13px]"
  >
    <span>{{ t('invite.label') }}</span>
    <span class="text-lg tracking-[0.15em] text-primary">{{ inviteCode }}</span>
    <span>{{ t('invite.roomId', { roomId }) }}</span>
  </div>
</template>
