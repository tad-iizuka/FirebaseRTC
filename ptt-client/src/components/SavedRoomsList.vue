<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SavedRoom } from '@/stores/savedRooms'
import Button from '@/components/ui/Button.vue'

const { t } = useI18n()
defineProps<{ rooms: SavedRoom[] }>()
const emit = defineEmits<{ open: [room: SavedRoom]; remove: [roomId: string] }>()
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
				<span class="block w-full truncate text-left">{{ room.label }} ({{ room.roomId }})</span>
			</Button>
			<Button variant="secondary" size="sm" @click="emit('remove', room.roomId)">{{ t('common.remove') }}</Button>
		</div>
	</div>
</template>
