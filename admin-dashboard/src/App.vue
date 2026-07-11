<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import AppHeader from '@/components/AppHeader.vue'
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
      <RouterView v-else />
    </div>
  </div>
</template>
