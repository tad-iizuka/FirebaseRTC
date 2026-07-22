<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConnectionStatusKind } from '@/stores/connection'
import { cn } from '@/lib/utils'

const { t } = useI18n()
const props = defineProps<{
  kind: ConnectionStatusKind
  message?: string | null
  roomId?: string | null
}>()

const dotClass = computed(() =>
  cn(
    'h-[7px] w-[7px] shrink-0 rounded-full bg-muted-foreground',
    props.kind === 'connected' && 'bg-live shadow-[0_0_6px_hsl(var(--live))]',
    props.kind === 'error' && 'bg-destructive',
    // [デザインシステム統一] 以前は accent(--primary)を流用していたが、
    // Android版(PTTColors.Warning)・iOS版(.pttWarning)と同じ意味の色に揃える。
    props.kind === 'reconnecting' && 'bg-warning shadow-[0_0_6px_hsl(var(--warning))]',
  ),
)

const text = computed(() => {
  switch (props.kind) {
    case 'disconnected':
      return t('status.disconnected')
    case 'connecting':
      return t('status.connecting')
    case 'connected':
      return t('status.connected', { roomId: props.roomId })
    case 'reconnecting':
      return t('status.reconnecting', { roomId: props.roomId })
    case 'error':
      return t('status.error', { message: props.message ?? '' })
  }
  return ''
})
</script>

<template>
  <div class="flex items-center gap-2 border-b border-border px-5 py-2.5 text-xs">
    <span :class="dotClass" />
    <span class="text-muted-foreground">{{ text }}</span>
  </div>
</template>
