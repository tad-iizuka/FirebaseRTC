<script setup lang="ts">
// [五十九訂: Web版レイアウト刷新]
// Mobile幅(768px未満)で「参加者」「チャット」タブを開いている間も送話できるよう、
// 画面下部に常設するPTTバー。押す/離すの実体はPttButton.vueと同じ
// connection.startTalking/stopTalkingへ委譲するだけで、送話ロジック自体は
// 一切変更していない(見た目だけが円ボタンではなく横長バーになったもの)。
// 「通話」タブでは主役の円ボタン(PttButton.vue)を表示し、このミニバーとは
// 二重表示させない(RoomView.vue側でv-ifにより排他制御)。
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
        'flex h-14 w-full shrink-0 select-none touch-none items-center justify-center gap-2 border-t border-border bg-card font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-30',
        isSending && 'bg-accent text-primary',
      )
    "
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <span
      class="h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-100"
      :class="isSending ? 'bg-primary shadow-[0_0_6px_hsl(var(--primary))]' : 'bg-muted-foreground'"
    />
    {{ label }}
  </button>
</template>
