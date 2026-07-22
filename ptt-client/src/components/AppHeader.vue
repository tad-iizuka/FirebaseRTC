<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
defineProps<{
  userName?: string | null
  channelLabel: string
}>()
const emit = defineEmits<{ signOut: [] }>()
</script>

<template>
  <div class="flex items-baseline justify-between border-b border-border px-5 py-3.5">
    <span class="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{{ t('header.appName') }}</span>
    <div v-if="userName" class="flex items-center gap-2">
      <span class="max-w-[10rem] truncate text-xs">{{ userName }}</span>
      <button
        type="button"
        class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        @click="emit('signOut')"
      >
        {{ t('header.signOut') }}
      </button>
    </div>
    <span class="text-[13px]">{{ channelLabel }}</span>
  </div>
</template>
