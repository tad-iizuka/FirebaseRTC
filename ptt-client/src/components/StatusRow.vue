<script setup lang="ts">
import { computed } from 'vue'
import type { ConnectionStatusKind } from '@/stores/connection'
import { cn } from '@/lib/utils'

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
    props.kind === 'reconnecting' && 'bg-primary',
  ),
)

const text = computed(() => {
  switch (props.kind) {
    case 'disconnected':
      return 'サーバ未接続'
    case 'connecting':
      return '接続中...'
    case 'connected':
      return `接続中 (room=${props.roomId})`
    case 'reconnecting':
      return `再接続中... (room=${props.roomId})`
    case 'error':
      return `エラー: ${props.message ?? ''}`
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
