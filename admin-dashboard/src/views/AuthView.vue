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
      この管理画面の利用には、運営担当者からの権限付与が必要です。
    </p>

    <Button :disabled="auth.isSigningIn" class="w-auto" @click="auth.signInWithGoogle">
      {{ auth.isSigningIn ? 'サインイン中...' : 'Googleでサインイン' }}
    </Button>

    <p v-if="auth.errorMessage" class="text-[11px] text-destructive">{{ auth.errorMessage }}</p>

    <!-- [2026-07-31 追加、item3(論点5)対応] 接続先URLは通常の利用者が
         意識する必要のない情報のため、未サインイン時は既定で隠す。
         接続先を切り替える必要がある運用者だけが開く想定
         (brushup-plan.md 二十六訂参照)。 -->
    <details class="text-[12px] text-muted-foreground">
      <summary class="cursor-pointer select-none">接続設定</summary>
      <div class="mt-2 grid gap-1">
        <label for="tokenServerUrl" class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          トークンサーバーURL
        </label>
        <Input id="tokenServerUrl" v-model="settings.tokenServerUrl" />
      </div>
    </details>
  </div>
</template>
