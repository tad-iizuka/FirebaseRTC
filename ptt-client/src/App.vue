<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useBanStore } from '@/stores/ban'
import { useSavedRoomsStore } from '@/stores/savedRooms'
import { useConnectionStore } from '@/stores/connection'
import { useOnboardingStore } from '@/stores/onboarding'
import { useRoomStore } from '@/stores/room'
import { useOrgContextStore } from '@/stores/orgContext'
import AppHeader from '@/components/AppHeader.vue'
import AuthView from '@/views/AuthView.vue'
import OnboardingFlow from '@/components/OnboardingFlow.vue'

const auth = useAuthStore()
const ban = useBanStore()
const savedRooms = useSavedRoomsStore()
const connection = useConnectionStore()
const onboarding = useOnboardingStore()
const roomStore = useRoomStore()
const orgContext = useOrgContextStore()

// [ヘッダーアイコンの表示名・再訂正] 組織(orgId)に紐づくRoomは最下層の
// ノード名を優先し、ノード未割り当てなら組織名、無所属Roomはルーム名を使う。
// RoomView.vue側のdisplayNameと同じロジック(orgContextはRoomView.vueが
// 入室時にfetchOnceする同一Piniaストアなので、ここでも同じ値をそのまま参照できる)。
const headerRoomName = computed(() => {
  const { orgName, breadcrumb } = orgContext
  if (breadcrumb.length > 0) return breadcrumb[breadcrumb.length - 1].name
  return orgName ?? roomStore.currentRoomName
})

// [ヘッダーの表示名]
// ゲストがルーム内で変更したニックネーム(ban.myDisplayName、rooms/{roomId}/members/{uid}の
// displayNameをonSnapshot購読したもの)はFirebase Authのプロフィールとは別物であり、
// auth.currentUser.displayNameには反映されない。ルーム入室中はそちらを優先し、
// 未入室時(ban.myDisplayNameが空)はFirebase Authの値にフォールバックする。
const headerDisplayName = computed(
  () => ban.myDisplayName || auth.currentUser?.displayName || auth.currentUser?.email || null,
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
					:user-name="headerDisplayName"
					:photo-url="auth.currentUser?.photoURL"
					:is-signed-in="!!auth.currentUser"
					:connection-status-kind="connection.statusKind"
					:room-id="connection.roomName"
					:room-name="headerRoomName"
					@sign-out="handleSignOut"
				/>
				<AuthView v-if="!auth.currentUser" />
				<RouterView v-else />
			</template>
		</div>
	</div>
</template>
