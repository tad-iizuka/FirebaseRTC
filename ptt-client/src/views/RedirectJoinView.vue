<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { savePendingJoin } from '@/lib/inviteLink'

// [招待リンク受け口] `/r?room=...&code=...` の一時的な着地点。
// このルートはrequiresAuthを付けていない(router/index.tsのbeforeEachでauthReady待ちを
// スキップさせるため)。未サインインでもここには即座に到達できる必要があり、
// サインイン待ちはRoomSelectView側(既存のApp.vueのAuthView分岐)に委ねる。
//
// ここでは room/code をsessionStorageへ一時保存し、'/'（room-select）へreplaceするだけ。
// 自動参加はしない(handleJoinRoomは呼ばない)。実際の入力欄への反映はRoomSelectView側で行う。

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

onMounted(() => {
  const room = typeof route.query.room === 'string' ? route.query.room : ''
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  if (room && code) {
    savePendingJoin({ roomId: room, inviteCode: code })
  }
  router.replace({ name: 'room-select' })
})
</script>

<template>
  <div class="p-6 text-center text-[13px] text-muted-foreground">{{ t('inviteLink.redirecting') }}</div>
</template>
