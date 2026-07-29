<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import Button from '@/components/ui/Button.vue'

const { t } = useI18n()
const auth = useAuthStore()
const settings = useSettingsStore()
</script>

<template>
  <div class="grid gap-3.5 p-3.5">
    <!-- [2026-07-29] トークンサーバーURL/LiveKit URLの入力フィールドは設定画面(歯車アイコン)へ移設した。
         普段は意識させず、接続先を確認したい場合だけここで一目で分かるようにする。 -->
    <p class="truncate text-[11px] text-muted-foreground" :title="settings.tokenServerUrl">
      {{ t('settings.currentServer', { url: settings.tokenServerUrl }) }}
    </p>

    <Button :disabled="auth.isSigningIn" @click="auth.signInWithGoogle">
      {{ auth.isSigningIn ? t('auth.signingIn') : t('auth.signInWithGoogle') }}
    </Button>
    <Button variant="secondary" :disabled="auth.isSigningIn" @click="auth.signInWithApple">
      {{ t('auth.signInWithApple') }}
    </Button>
    <Button variant="secondary" :disabled="auth.isSigningIn" @click="auth.signInAsGuest">
      {{ t('auth.signInAsGuest') }}
    </Button>
    <p class="text-[11px] text-muted-foreground">{{ t('auth.guestHint') }}</p>

    <p v-if="auth.errorMessage" class="text-[11px] text-destructive">{{ auth.errorMessage }}</p>
  </div>
</template>
