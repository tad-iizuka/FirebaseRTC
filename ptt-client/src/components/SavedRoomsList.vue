<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SavedRoom } from '@/stores/savedRooms'
import Button from '@/components/ui/Button.vue'

const { t } = useI18n()
defineProps<{ rooms: SavedRoom[] }>()
const emit = defineEmits<{ open: [room: SavedRoom]; remove: [roomId: string] }>()

// [表示仕様・2026-08-06] 上段: ルーム名があればルーム名、無ければroomId。
// 下段: 開始/終了時刻。どちらも未指定なら空欄(行自体は残すが空文字を表示)。
function primaryLabel(room: SavedRoom): string {
	return room.name ?? room.roomId
}

function scheduleLabel(room: SavedRoom): string {
	const schedule = room.schedule
	if (!schedule || (!schedule.start && !schedule.end)) return ''
	const format = (ms: number) =>
		new Date(ms).toLocaleString(undefined, {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		})
	if (schedule.start && schedule.end) return `${format(schedule.start)} – ${format(schedule.end)}`
	if (schedule.start) return format(schedule.start)
	if (schedule.end) return format(schedule.end)
	return ''
}
</script>

<template>
	<div v-if="rooms.length" class="grid gap-2">
		<span class="text-center text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
			{{ t('roomSelect.recentRooms') }}
		</span>
		<div v-for="room in rooms" :key="room.roomId" class="flex min-w-0 items-center gap-2">
			<Button
				variant="secondary"
				class="min-w-0 flex-1 justify-start normal-case"
				@click="emit('open', room)"
			>
				<span class="block w-full min-w-0 text-left">
					<span class="block truncate">{{ primaryLabel(room) }}</span>
					<span class="block truncate text-[11px] text-muted-foreground">{{ scheduleLabel(room) }}</span>
				</span>
			</Button>
			<Button variant="secondary" size="sm" @click="emit('remove', room.roomId)">{{ t('common.remove') }}</Button>
		</div>
	</div>
</template>
