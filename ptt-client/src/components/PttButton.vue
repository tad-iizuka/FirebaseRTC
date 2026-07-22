<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'

const { t } = useI18n()
const props = defineProps<{
  disabled: boolean
  isSending: boolean
  lockedByName?: string | null
}>()

const emit = defineEmits<{
  start: []
  stop: []
}>()

const label = computed(() => {
  if (props.lockedByName) return t('ptt.talkingByName', { name: props.lockedByName })
  if (props.isSending) return t('ptt.talking')
  return t('ptt.pressToTalk')
})

// Pointer Events はマウス・タッチ・ペンを一本化して扱えるため、旧実装の
// mousedown/mouseup/mouseleave + touchstart/touchend の重複ハンドラを置き換える。
function onPointerDown(e: PointerEvent) {
  if (props.disabled) return
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  emit('start')
}
function onPointerUp() {
  emit('stop')
}
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :class="
      cn(
        'flex h-36 w-36 select-none touch-none flex-col items-center justify-center rounded-full border-2 border-border bg-[radial-gradient(circle_at_35%_30%,#1c2620,#10160f)] font-mono text-xs uppercase tracking-wider text-muted-foreground transition-[border-color,color,transform] duration-100 disabled:cursor-not-allowed disabled:opacity-30 sm:h-40 sm:w-40',
        isSending && 'scale-[0.97] border-primary text-primary shadow-[0_0_24px_-4px_hsl(var(--primary))]',
      )
    "
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    {{ label }}
  </button>
</template>
