<script setup lang="ts">
import { ref, watch } from 'vue'
import QRCode from 'qrcode'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import { buildInviteLink } from '@/lib/inviteLink'

// [招待リンク/QR生成] 既に画面上に招待コードが表示されている(=rooms:manage権限で
// 取得済み)状態でのみ使う前提のコンポーネント。ここでは新規のtoken-server API呼び出しは
// 行わず、既知のroomId/inviteCodeからURLを組み立てるだけ(deeplink-qr-join-plan.md参照)。
// 生成箇所: RoomsListView.vue(作成直後) / RoomDetailView.vue(Room詳細)

const props = defineProps<{ roomId: string; inviteCode: string }>()

const isQrOpen = ref(false)
const isLinkCopied = ref(false)
const qrDataUrl = ref<string | null>(null)

const inviteLink = buildInviteLink(props.roomId, props.inviteCode)

async function copyLink() {
  try {
    await navigator.clipboard.writeText(inviteLink)
    isLinkCopied.value = true
    setTimeout(() => (isLinkCopied.value = false), 1500)
  } catch {
    // クリップボードAPIが使えない環境では何もしない(コピー結果が見えないだけ)
  }
}

async function toggleQr() {
  if (isQrOpen.value) {
    isQrOpen.value = false
    return
  }
  if (!qrDataUrl.value) {
    qrDataUrl.value = await QRCode.toDataURL(inviteLink, { margin: 1, width: 240 })
  }
  isQrOpen.value = true
}

// roomId/inviteCodeはpropsとして固定想定だが、念のため変わった場合はQR再生成対象にする
watch(
  () => [props.roomId, props.inviteCode],
  () => {
    qrDataUrl.value = null
    isQrOpen.value = false
  },
)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <Button size="sm" variant="secondary" class="h-7 w-auto px-2 text-[11px]" @click="copyLink">
      {{ isLinkCopied ? 'コピーしました' : '招待リンクをコピー' }}
    </Button>
    <Button size="sm" variant="secondary" class="h-7 w-auto px-2 text-[11px]" @click="toggleQr">
      {{ isQrOpen ? 'QRコードを閉じる' : 'QRコードを表示' }}
    </Button>
  </div>

  <Card v-if="isQrOpen && qrDataUrl" class="mt-2 flex w-fit flex-col items-center gap-2 p-3">
    <img :src="qrDataUrl" alt="招待QRコード" width="240" height="240" />
    <a :href="qrDataUrl" download="invite-qr.png" class="text-[11px] text-primary hover:underline">
      画像をダウンロード
    </a>
  </Card>
</template>
