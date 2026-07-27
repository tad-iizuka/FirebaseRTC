<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useUserDirectoryStore } from '@/stores/userDirectory'
import { useAdminBadgesStore } from '@/stores/adminBadges'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'

// [2026-07-27新設] ユーザープロフィール画面。バッジの付与/剥奪をここで行う
// (旧: RoomDetailView.vueのメンバー台帳。バッジはRoomに紐付かないユーザー
// 単位の概念のため、Room詳細画面からの操作は不自然というユーザー指摘を受け
// てこちらに一本化した。brushup-plan.md参照)。
//
// [拡張性について] 現時点ではバッジ付与/剥奪のみだが、将来のユーザー無効化
// 等の他の操作もこの画面に追加していくことを見込んだ構成にしている
// (5.2「削除の実体: ユーザー無効化」)。プロフィール取得APIのレスポンスに
// 既に`disabled`フィールドを含めているのはその布石。

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const store = useUserDirectoryStore()
const badgesStore = useAdminBadgesStore()

const uid = computed(() => String(route.params.uid))

function load() {
  store.fetchProfile(settings.tokenServerUrl, uid.value).catch(() => {})
}
onMounted(() => {
  load()
  // バッジ付与フォームの選択肢用(RoomDetailView.vueと同じ)。
  badgesStore.fetchBadges(settings.tokenServerUrl).catch(() => {})
})

function back() {
  store.clearProfile()
  router.push({ name: 'users' })
}

// 手動付与可能(active かつ grantMethod が manual/both)なバッジのみを選択肢にする。
const grantableBadges = computed(() =>
  badgesStore.badges.filter((b) => b.active && (b.grantMethod === 'manual' || b.grantMethod === 'both')),
)

// 既に付与済みのバッジは選択肢から外す(grantBadge側の一意性チェックで
// 409になる前に、UI側でも防ぐ。RoomDetailView.vueと同じ考え方)。
const grantableBadgesForUser = computed(() => {
  const grantedIds = new Set((store.profile?.badges ?? []).map((b) => b.badgeId))
  return grantableBadges.value.filter((b) => !grantedIds.has(b.badgeId))
})

const badgeDraft = ref('')

async function grantBadge() {
  if (!badgeDraft.value) return
  try {
    await store.grantBadge(settings.tokenServerUrl, uid.value, badgeDraft.value)
    badgeDraft.value = ''
  } catch {
    // store.grantErrorMessage に反映済み
  }
}

async function revokeBadge(badgeId: string) {
  try {
    await store.revokeBadge(settings.tokenServerUrl, uid.value, badgeId)
  } catch {
    // store.grantErrorMessage に反映済み
  }
}
</script>

<template>
  <div class="p-5">
    <Button variant="secondary" size="sm" class="mb-4 w-auto" @click="back">← 一覧に戻る</Button>

    <p v-if="store.isProfileForbidden" class="text-xs text-destructive">管理者権限がありません。</p>
    <p v-else-if="store.isProfileNotFound" class="text-xs text-destructive">
      指定されたユーザーが見つかりません(uid: {{ uid }})。
    </p>
    <p v-else-if="store.profileErrorMessage" class="text-xs text-destructive">
      プロフィールの取得に失敗しました: {{ store.profileErrorMessage }}
    </p>
    <p v-else-if="store.isLoadingProfile && !store.profile" class="text-xs text-muted-foreground">読み込み中...</p>

    <template v-if="store.profile">
      <h2 class="mb-1 text-sm font-semibold">{{ store.profile.email }}</h2>
      <p class="mb-4 text-[11px] text-muted-foreground">
        uid: {{ store.profile.uid }}
        <span v-if="store.profile.disabled"> / <Badge variant="destructive">無効化済み</Badge></span>
      </p>

      <h3 class="mb-2 text-[12px] font-medium">バッジ</h3>
      <!-- [Phase13] Guestは資格・勤続バッジの付与対象外(役割バッジのみ)。
           このプロフィール画面にGuestが表示されること自体、メールアドレスを
           持たないためほぼ想定していないが(検索一覧に出てこない)、
           直接uid指定でアクセスされた場合に備えサーバー側でも同じガードを
           かけている(token-server/routes/users.js参照)。 -->
      <p v-if="badgesStore.isForbidden" class="mb-2 text-[11px] text-muted-foreground">
        バッジ定義一覧の取得に失敗しました(badges:monitor 権限が必要です)。選択肢が表示されません。
      </p>
      <p v-if="store.grantErrorMessage" class="mb-2 text-[11px] text-destructive">
        {{ store.grantErrorMessage }}
      </p>

      <div class="mb-3 flex flex-wrap items-center gap-1.5">
        <span
          v-for="assigned in store.profile.badges"
          :key="assigned.badgeId"
          class="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px]"
          :title="assigned.name"
        >
          <span>{{ assigned.icon }}</span>
          <span>{{ assigned.name }}</span>
          <button
            type="button"
            class="text-destructive opacity-70 hover:opacity-100"
            :disabled="store.isGranting"
            @click="revokeBadge(assigned.badgeId)"
          >
            ×
          </button>
        </span>
        <span v-if="store.profile.badges.length === 0" class="text-[11px] text-muted-foreground">
          バッジなし
        </span>
      </div>

      <div class="flex max-w-md items-center gap-1.5">
        <select
          v-model="badgeDraft"
          class="h-9 flex-1 rounded-sm border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
          :disabled="store.isGranting"
        >
          <option value="">(バッジを選択)</option>
          <option v-for="b in grantableBadgesForUser" :key="b.badgeId" :value="b.badgeId">
            {{ b.icon }} {{ b.name }}
          </option>
        </select>
        <Button
          size="sm"
          variant="secondary"
          class="h-9 w-auto px-3 text-[11px]"
          :disabled="store.isGranting || !badgeDraft"
          @click="grantBadge"
        >
          {{ store.isGranting ? '処理中...' : '付与' }}
        </Button>
      </div>
    </template>
  </div>
</template>
