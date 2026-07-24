<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const { t } = useI18n()

const props = defineProps<{
  isRecording: boolean
  startedAt: number | null
  /** owner/moderatorのみ true。開始/停止ボタンの表示可否。 */
  canControl: boolean
  starting: boolean
  stopping: boolean
  errorMessage: string | null
}>()

const emit = defineEmits<{
  start: []
  stop: []
}>()

const showStartConfirm = ref(false)

// [経過時間表示]
// startedAt はサーバー(token-server/lib/roomMetadata.js)がRoom Metadata経由で
// 配信するUnix時刻(ms)。ここではUIの経過時間表示のためだけに1秒毎に再計算する。
const nowMs = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tickTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})

const elapsedLabel = computed(() => {
  if (!props.startedAt) return null
  const totalSeconds = Math.max(0, Math.floor((nowMs.value - props.startedAt) / 1000))
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0')
  const s = (totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

function onStartClick() {
  showStartConfirm.value = true
}
function onConfirmStart() {
  showStartConfirm.value = false
  emit('start')
}
</script>

<template>
  <div>
    <!-- [同意表示] 録音中であることは全参加者に開示する(法的な同意の観点で必須)。
         ロールに関わらず全員に常時表示する。 -->
    <div
      v-if="isRecording"
      role="status"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-destructive/60 bg-destructive/10 px-5 py-2.5 text-xs text-destructive"
    >
      <span class="relative flex h-2 w-2 shrink-0">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
        <span class="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
      </span>
      <span class="font-semibold">{{ t('recording.badge') }}</span>
      <span v-if="elapsedLabel" class="font-mono text-muted-foreground">{{ elapsedLabel }}</span>
      <span class="basis-full text-[11px] text-muted-foreground sm:basis-auto">{{ t('recording.consentNotice') }}</span>
    </div>

    <div v-if="canControl" class="flex items-center gap-2 px-5 pb-0 pt-2">
      <Button
        v-if="!isRecording"
        variant="secondary"
        size="sm"
        :disabled="starting"
        @click="onStartClick"
      >
        {{ starting ? t('recording.starting') : t('recording.start') }}
      </Button>
      <Button v-else variant="destructive" size="sm" :disabled="stopping" @click="emit('stop')">
        {{ stopping ? t('recording.stopping') : t('recording.stop') }}
      </Button>
      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>
    </div>

    <ConfirmDialog
      :open="showStartConfirm"
      :title="t('recording.startConfirmTitle')"
      :description="t('recording.startConfirmDescription')"
      :confirm-label="t('recording.startConfirmLabel')"
      @confirm="onConfirmStart"
      @cancel="showStartConfirm = false"
    />
  </div>
</template>
