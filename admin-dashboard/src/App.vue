<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import AppHeader from '@/components/AppHeader.vue'
import NavTabs from '@/components/NavTabs.vue'
import AuthView from '@/views/AuthView.vue'

const auth = useAuthStore()
</script>

<template>
  <div class="min-h-dvh p-4 sm:p-6">
    <div class="mx-auto w-full max-w-5xl overflow-hidden rounded-md border border-border bg-card">
      <AppHeader
        :user-name="auth.currentUser?.displayName ?? auth.currentUser?.email"
        @sign-out="auth.signOut"
      />
      <AuthView v-if="!auth.currentUser" />
      <!-- [Phase8] 監査ログ・管理者権限タブの追加に伴い、サインイン後は
           NavTabsで画面を切り替えられるようにする。 -->
      <template v-else>
        <NavTabs />
        <RouterView />
      </template>
    </div>
  </div>
</template>
