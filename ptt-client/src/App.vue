<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
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
const route = useRoute()

// [五十九訂: レイアウト刷新] room画面のみ、カード全体を画面いっぱいの高さで固定し、
// 幅も768px以上向けの3ペイン構成が収まるよう広げる。auth/room-select等の他画面は
// 従来通り(中央寄せ・高さは内容に応じて可変)のまま変更しない。
const isRoomRoute = computed(() => route.name === 'room')

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
	<div
		class="flex p-4 sm:p-6"
		:class="isRoomRoute ? 'h-dvh items-stretch justify-center' : 'min-h-dvh items-start justify-center sm:items-center'"
	>
		<div
			class="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card"
			:class="isRoomRoute ? 'h-full max-w-[1100px]' : 'max-w-[420px]'"
		>
			<!-- [オンボーディング] 初回起動時はサインイン前でもスワイプ形式の紹介画面を最優先で表示する -->
			<OnboardingFlow v-if="!onboarding.hasCompletedOnboarding" @complete="onboarding.complete" />
			<template v-else>
				<AppHeader
					class="shrink-0"
					:user-name="headerDisplayName"
					:photo-url="auth.currentUser?.photoURL"
					:is-signed-in="!!auth.currentUser"
					:connection-status-kind="connection.statusKind"
					:status-message="connection.statusMessage"
					:org-name="orgContext.orgName"
					@sign-out="handleSignOut"
				/>
				<AuthView v-if="!auth.currentUser" />
				<!-- [五十九訂] RouterViewのclassはフォールスルー属性としてRoomView.vue等の
				     ルート要素にそのままマージされる。room画面ではこのflex-1/min-h-0が
				     3ペイン/タブ切り替えの高さの基準になる。他画面(単一カラムで内容量に
				     応じた高さ)には影響しない。 -->
				<RouterView v-else class="min-h-0 flex-1" />
			</template>
		</div>
	</div>
</template>
