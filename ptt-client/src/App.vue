<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useBanStore } from '@/stores/ban'
import { useSavedRoomsStore } from '@/stores/savedRooms'
import { useConnectionStore } from '@/stores/connection'
import { useOnboardingStore } from '@/stores/onboarding'
import { useOrgContextStore } from '@/stores/orgContext'
import AppHeader from '@/components/AppHeader.vue'
import AuthView from '@/views/AuthView.vue'
import OnboardingFlow from '@/components/OnboardingFlow.vue'

const auth = useAuthStore()
const ban = useBanStore()
const savedRooms = useSavedRoomsStore()
const connection = useConnectionStore()
const onboarding = useOnboardingStore()
const orgContext = useOrgContextStore()

// [ヘッダー左側テキストの参照元・再修正 2026-08-05] 前回の移植時、iOS版の
// header()が組織名(orgContext.orgName)のみを表示している点を見落とし、
// 誤って「breadcrumb最下層ノード名→組織名→ルーム名」という3段フォールバック
// (displayNameロジック。RoomView.vueのh1・iOS版roomNameHeaderが使うものと同じ)を
// そのまま流用してしまっていた。この結果、Web版ヘッダーには「東北警備株式会社」
// (組織名)ではなく「仙台駅現場」(breadcrumb最下層ノード名)が表示されてしまい、
// iOS実機のスクリーンショットとの間で表示差分が生じていた。
// iOS版ContentView.swiftのheader()は`if let orgName = orgContext.orgName`のみを
// 参照しており、breadcrumbやルーム名へのフォールバックは行わない(未設定なら
// 何も表示しない)。RoomView.vue側のh1(displayName相当)・OrgBreadcrumbは
// これとは別の表示であり、今回の修正対象ではない(前回同様、変更していない)。

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
					:status-message="connection.statusMessage"
					:org-name="orgContext.orgName"
					@sign-out="handleSignOut"
				/>
				<AuthView v-if="!auth.currentUser" />
				<RouterView v-else />
			</template>
		</div>
	</div>
</template>
