<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LoginStatusIcon from '@/components/LoginStatusIcon.vue'
import SettingsIcon from '@/components/SettingsIcon.vue'
import type { ConnectionStatusKind } from '@/stores/connection'

const { t } = useI18n()
const props = defineProps<{
  userName?: string | null
  photoUrl?: string | null
  isSignedIn: boolean
  connectionStatusKind: ConnectionStatusKind
  statusMessage?: string | null
  // [表示差分修正・2026-08-05] 組織名(orgContext.orgName)をそのまま表示する。
  // iOS版ContentView.swiftのheader()が`orgContext.orgName`のみを参照し、
  // breadcrumb最下層ノード名やルーム名へのフォールバックを行わない(未設定なら
  // 何も表示しない)のに合わせている。RoomView.vue側のh1(displayName相当・
  // breadcrumb最下層優先)・OrgBreadcrumbとは別の値である点に注意
  // (詳細はbrushup-plan.md参照)。
  orgName?: string | null
}>()
const emit = defineEmits<{ signOut: [] }>()

// [不具合修正・2026-08-04、表示差分再修正・2026-08-05] 以前はここに固定文言
// (アプリ名)+ConnectionStatusIcon(接続状態を丸アイコン1文字で表す)を表示していたが、
// 「アプリ名の静的表示」「アイコンだけでは何の状態か分かりにくい」という指摘を受け、
// iOS版に合わせて、左側は組織名(未設定時は非表示)、右側は接続状態のドット+テキストを
// 直接ヘッダーに並べる形へ変更した。これに伴い、RoomView.vue側にあった重複表示の
// StatusRow(room=付き)は廃止した。ConnectionStatusIcon.vue・StatusRow.vueも
// 参照元が本コンポーネント/RoomView.vueのみだったため、あわせて削除した。
// 2026-08-05: 初回移植時、左側テキストの参照元を誤ってbreadcrumb最下層ノード名優先の
// displayNameロジックにしてしまっていた(iOS実機との表示差分としてユーザーから
// 指摘を受け発覚)。orgContext.orgNameを直接参照する形に修正した。
const statusDotClass = computed(() => {
  switch (props.connectionStatusKind) {
    case 'connected':
      return 'bg-live shadow-[0_0_6px_hsl(var(--live))]'
    case 'reconnecting':
      return 'bg-warning shadow-[0_0_6px_hsl(var(--warning))]'
    case 'error':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground'
  }
})

// [室外(room=なし)重複の解消] connected/reconnectingの文言からroom=部分を落とした
// status.connectedShort/reconnectingShortを新設。ルーム名自体は本文側(RoomView.vueの
// h1)で既に表示されているため、ここで再掲すると重複になる(iOS版statusText参照)。
const statusText = computed(() => {
  switch (props.connectionStatusKind) {
    case 'disconnected':
      return t('status.disconnected')
    case 'connecting':
      return t('status.connecting')
    case 'connected':
      return t('status.connectedShort')
    case 'reconnecting':
      return t('status.reconnectingShort')
    case 'error':
      return t('status.error', { message: props.statusMessage ?? '' })
    default:
      return ''
  }
})
</script>

<template>
  <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
    <span v-if="orgName" class="truncate text-[11px] tracking-[0.04em] text-muted-foreground">{{ orgName }}</span>
    <span v-else />
    <div class="flex shrink-0 items-center gap-3">
      <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span class="h-[7px] w-[7px] shrink-0 rounded-full" :class="statusDotClass" />
        <span class="whitespace-nowrap">{{ statusText }}</span>
      </div>
      <SettingsIcon />
      <LoginStatusIcon
        :photo-url="photoUrl"
        :display-name="userName"
        :is-signed-in="isSignedIn"
        @sign-out="emit('signOut')"
      />
    </div>
  </div>
</template>
