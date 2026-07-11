<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const auth = useAuthStore()
const settings = useSettingsStore()
</script>

<template>
  <div class="grid gap-3.5 p-5">
    <p class="rounded-sm border border-border bg-background p-2.5 text-[12px] text-muted-foreground">
      閲覧には Firestore の <code>adminUsers/&#123;uid&#125;.permissions</code> に
      <code>rooms:monitor</code> が付与されたアカウントでのサインインが必要です (<code
        >dev-tools/grant-admin-permission.js</code
      >
      で付与)。
    </p>

    <div class="grid gap-1">
      <label for="tokenServerUrl" class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        トークンサーバーURL
      </label>
      <Input id="tokenServerUrl" v-model="settings.tokenServerUrl" />
    </div>

    <Button :disabled="auth.isSigningIn" class="w-auto" @click="auth.signInWithGoogle">
      {{ auth.isSigningIn ? 'サインイン中...' : 'Googleでサインイン' }}
    </Button>

    <p v-if="auth.errorMessage" class="text-[11px] text-destructive">{{ auth.errorMessage }}</p>
  </div>
</template>
