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
  // [表示名] 組織(orgId)に紐づくRoomは最下層のノード名を優先し、ノード未割り当てなら
  // 組織名、無所属Roomはルーム名を使う(App.vue側のheaderRoomName、RoomView.vueの
  // displayNameと同じロジック)。未入室・未設定(null)の場合はアプリ名にフォールバックする。
  roomName?: string | null
}>()
const emit = defineEmits<{ signOut: [] }>()

// [不具合修正・2026-08-04] 以前はここに固定文言(アプリ名)+ConnectionStatusIcon
// (接続状態を丸アイコン1文字で表す)を表示していたが、「アプリ名の静的表示」
// 「アイコンだけでは何の状態か分かりにくい」という指摘を受け、iOS版
// (ptt-ios/ptt-ios/ContentView.swift、6訂)に合わせて、左側は組織/ルーム名(未設定時は
// アプリ名)、右側は接続状態のドット+テキストを直接ヘッダーに並べる形へ変更した。
// これに伴い、RoomView.vue側にあった重複表示のStatusRow(room=付き)は廃止した
// (詳細はbrushup-plan.md参照)。ConnectionStatusIcon.vueも本コンポーネント以外から
// 参照されていなかったため、あわせて削除した。
const headerText = computed(() => props.roomName || t('header.appName'))

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
// status.connectedShort/reconnectingShortを新設。ルーム名自体は左側(headerText)で
// 既に表示されているため、ここで再掲すると重複になる(iOS版statusText参照)。
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
    <span class="truncate text-[11px] tracking-[0.04em] text-muted-foreground">{{ headerText }}</span>
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
