<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { WifiOff } from '@lucide/vue'
import type { ConnectionStatusKind } from '@/stores/connection'

const props = defineProps<{
  statusKind: ConnectionStatusKind
  roomId: string | null
}>()

const { t } = useI18n()

// [接続中/再接続中はどちらもルームIDの頭文字を表示する]
// 元の channelLabel ロジック(App.vue)を踏襲: connected/reconnecting のみ
// ルーム情報を表示し、それ以外(disconnected/connecting/error)は
// 「未接続」として扱う。見た目(色)だけ reconnecting で区別する。
const isLive = computed(() => props.statusKind === 'connected' || props.statusKind === 'reconnecting')
const isReconnecting = computed(() => props.statusKind === 'reconnecting')

const initial = computed(() => {
	if (!props.roomId) return ''
	// サロゲートペア対策で配列展開してから先頭1文字を取る
	return [...props.roomId][0]?.toUpperCase() ?? ''
})

const label = computed(() =>
	isLive.value ? t('common.connectedToRoom', { roomId: props.roomId }) : t('common.notConnected'),
)
</script>

<template>
	<div
		class="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full border text-xs font-semibold uppercase leading-none transition-colors"
		:class="
			isLive
				? isReconnecting
					? 'animate-pulse border-warning/40 bg-warning/15 text-warning'
					: 'border-live/40 bg-live/15 text-live'
				: 'border-dashed border-muted-foreground/35 bg-transparent text-muted-foreground'
		"
		:title="label"
		role="img"
		:aria-label="label"
	>
		<span v-if="isLive" aria-hidden="true">{{ initial }}</span>
		<WifiOff v-else class="h-3.5 w-3.5" aria-hidden="true" :stroke-width="2" />
	</div>
</template>
