<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useSavedRoomsStore } from '@/stores/savedRooms'
import { useConnectionStore } from '@/stores/connection'
import { useOnboardingStore } from '@/stores/onboarding'
import AppHeader from '@/components/AppHeader.vue'
import AuthView from '@/views/AuthView.vue'
import OnboardingFlow from '@/components/OnboardingFlow.vue'

const auth = useAuthStore()
const savedRooms = useSavedRoomsStore()
const connection = useConnectionStore()
const onboarding = useOnboardingStore()

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
			<!-- [オンボーディング] 初回起動時はサインイン前でもスワイプ形式の紹介画面を最優先で表示する -->
			<OnboardingFlow v-if="!onboarding.hasCompletedOnboarding" @complete="onboarding.complete" />
			<template v-else>
				<AppHeader
					:user-name="auth.currentUser?.displayName ?? auth.currentUser?.email"
					:channel-label="channelLabel"
					@sign-out="handleSignOut"
				/>
				<AuthView v-if="!auth.currentUser" />
				<RouterView v-else />
			</template>
		</div>
	</div>
</template>
