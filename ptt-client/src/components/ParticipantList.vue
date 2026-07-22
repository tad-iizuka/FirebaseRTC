<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ParticipantInfo } from '@/stores/connection'
import Badge from '@/components/ui/Badge.vue'

const { t } = useI18n()
defineProps<{
  participants: ParticipantInfo[]
  canBan: boolean
}>()
const emit = defineEmits<{
  ban: [participant: ParticipantInfo]
  report: [participant: ParticipantInfo]
}>()
</script>

<template>
  <div class="border-t border-border px-5 py-4">
    <div class="mb-2 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{{ t('participants.title') }}</div>
    <div class="flex min-h-[22px] flex-wrap gap-1.5">
      <Badge v-if="participants.length === 0">{{ t('participants.none') }}</Badge>
      <Badge v-for="p in participants" :key="p.identity" :variant="p.muted ? 'default' : 'live'">
        <span>{{ p.name }}</span>
        <button type="button" class="opacity-70 underline hover:opacity-100" @click="emit('report', p)">
          {{ t('participants.report') }}
        </button>
        <button
          v-if="canBan"
          type="button"
          class="text-destructive opacity-70 underline hover:opacity-100"
          @click="emit('ban', p)"
        >
          {{ t('participants.ban') }}
        </button>
      </Badge>
    </div>
  </div>
</template>
