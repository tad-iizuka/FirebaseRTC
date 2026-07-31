<script setup lang="ts">
import { watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import AppHeader from '@/components/AppHeader.vue'
import NavTabs from '@/components/NavTabs.vue'
import AuthView from '@/views/AuthView.vue'

const auth = useAuthStore()
const settings = useSettingsStore()

// [2026-07-31 追加、item3(論点5)対応]
// サインイン成功直後に自分の権限一覧を取得する。以前は auth.currentUser の
// 有無だけでNavTabsの表示を切り替えており、権限の有無を見ていなかった
// (brushup-plan.md 二十六訂参照)。
watch(
  () => auth.currentUser,
  (user) => {
    if (user) auth.fetchPermissions(settings.tokenServerUrl)
  },
  { immediate: true },
)
</script>

<template>
  <div class="min-h-dvh p-4 sm:p-6">
    <div class="mx-auto w-full max-w-5xl overflow-hidden rounded-md border border-border bg-card">
      <AppHeader
        :user-name="auth.currentUser?.displayName ?? auth.currentUser?.email"
        @sign-out="auth.signOut"
      />
      <AuthView v-if="!auth.currentUser" />
      <div v-else-if="auth.isLoadingPermissions" class="p-5 text-[13px] text-muted-foreground">
        確認中…
      </div>
      <!-- [2026-07-31 追加] サインインはできても権限が1つも無い場合は、
           NavTabs自体を出さずここで止める。個々の画面のAPI呼び出しが
           403で弾かれることに変わりはないが、メニュー構成自体を
           無関係な第三者に見せないための事前ゲート。 -->
      <div v-else-if="(auth.permissions?.length ?? 0) === 0" class="grid gap-2 p-5">
        <p class="text-[13px] text-foreground">この管理画面を利用する権限がありません。</p>
        <p class="text-[12px] text-muted-foreground">
          利用が必要な場合は、システムの運営担当者にお問い合わせください。
        </p>
      </div>
      <!-- [Phase8] 監査ログ・管理者権限タブの追加に伴い、サインイン後は
           NavTabsで画面を切り替えられるようにする。 -->
      <template v-else>
        <NavTabs />
        <RouterView />
      </template>
    </div>
  </div>
</template>
