<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import jsQR from 'jsqr'
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import { parseInviteLink, type ParsedInvite } from '@/lib/inviteLink'

// [アプリ内QRスキャナー] OS標準カメラでのUniversal Link起動をメイン導線としつつ、
// カメラ権限を許可すればアプリ内からも読み取れるようにするための補助機能
// (deeplink-qr-join-plan.md Phase D)。
// 読み取った文字列は招待リンク生成側(admin-dashboard/lib/inviteLink.ts)と同一の
// URLフォーマットを前提にparseInviteLinkへ通し、成功時のみ`decoded`イベントで通知する。
// 自動参加はしない(呼び出し側であるRoomSelectView.vueが入力欄へ反映するのみ)。

const { t } = useI18n()
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; decoded: [ParsedInvite] }>()

const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const errorMessage = ref<string | null>(null)

let stream: MediaStream | null = null
let rafId: number | null = null

async function start() {
  errorMessage.value = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  } catch {
    errorMessage.value = t('inviteLink.cameraPermissionDenied')
    return
  }
  if (videoRef.value) {
    videoRef.value.srcObject = stream
    await videoRef.value.play()
  }
  scanLoop()
}

function stop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}

function scanLoop() {
  const video = videoRef.value
  const canvas = canvasRef.value
  if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
    rafId = requestAnimationFrame(scanLoop)
    return
  }
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    rafId = requestAnimationFrame(scanLoop)
    return
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, imageData.width, imageData.height)
  if (code) {
    const parsed = parseInviteLink(code.data)
    if (parsed) {
      stop()
      emit('decoded', parsed)
      return
    }
    // 招待リンクの形式ではないQRだった場合は、読み取りを続ける(エラーにはしない)。
  }
  rafId = requestAnimationFrame(scanLoop)
}

watch(
  () => props.open,
  (open) => {
    if (open) start()
    else stop()
  },
)

onBeforeUnmount(stop)
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    @keydown.esc="emit('close')"
  >
    <Card class="w-full max-w-sm p-5">
      <h2 class="mb-3 text-sm font-semibold">{{ t('inviteLink.scanTitle') }}</h2>

      <div class="mb-3 aspect-square w-full overflow-hidden rounded-sm bg-black">
        <video ref="videoRef" class="h-full w-full object-cover" muted playsinline></video>
        <canvas ref="canvasRef" class="hidden"></canvas>
      </div>

      <p v-if="errorMessage" class="mb-3 text-[11px] text-destructive">{{ errorMessage }}</p>
      <p v-else class="mb-3 text-[11px] text-muted-foreground">{{ t('inviteLink.scanHint') }}</p>

      <div class="flex justify-end">
        <Button variant="secondary" size="sm" @click="emit('close')">{{ t('common.cancel') }}</Button>
      </div>
    </Card>
  </div>
</template>
