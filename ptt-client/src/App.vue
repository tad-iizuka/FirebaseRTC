<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useSavedRoomsStore } from '@/stores/savedRooms'
import { useConnectionStore } from '@/stores/connection'
import AppHeader from '@/components/AppHeader.vue'
import AuthView from '@/views/AuthView.vue'

const auth = useAuthStore()
const savedRooms = useSavedRoomsStore()
const connection = useConnectionStore()

const channelLabel = computed(() =>
	connection.statusKind === 'connected' || connection.statusKind === 'reconnecting'
		? `room: ${connection.roomName}`
		: '未接続',
)

// uidが確定/変化するたびに、そのユーザーのルーム履歴を読み直す
// (サインアウト/別アカウントでの汚染を防ぐため、savedRooms.load()内でキーを切り替える)。
onMounted(() => {
	auth.$subscribe(() => {
		savedRooms.load(auth.currentUser?.uid)
	})
	savedRooms.load(auth.currentUser?.uid)
})

async function handleSignOut() {
	if (connection.isConnected) await connection.disconnect()
	await auth.signOut()
}
</script>

<template>
	<div class="flex min-h-dvh items-start justify-center p-4 sm:items-center sm:p-6">
		<div class="w-full min-w-0 max-w-[420px] overflow-hidden rounded-md border border-border bg-card">
			<AppHeader
				:user-name="auth.currentUser?.displayName ?? auth.currentUser?.email"
				:channel-label="channelLabel"
				@sign-out="handleSignOut"
			/>
			<AuthView v-if="!auth.currentUser" />
			<RouterView v-else />
		</div>
	</div>
</template>
