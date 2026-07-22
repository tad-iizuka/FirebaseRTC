<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const { t } = useI18n()
const auth = useAuthStore()
const settings = useSettingsStore()
</script>

<template>
  <div class="grid gap-3.5 p-3.5">
    <div class="grid gap-1">
      <label for="tokenServerUrl" class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {{ t('auth.tokenServerUrl') }}
      </label>
      <Input id="tokenServerUrl" v-model="settings.tokenServerUrl" />
    </div>
    <div class="grid gap-1">
      <label for="livekitUrl" class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {{ t('auth.livekitUrl') }}
      </label>
      <Input id="livekitUrl" v-model="settings.livekitUrl" />
    </div>

    <Button :disabled="auth.isSigningIn" @click="auth.signInWithGoogle">
      {{ auth.isSigningIn ? t('auth.signingIn') : t('auth.signInWithGoogle') }}
    </Button>
    <Button variant="secondary" :disabled="auth.isSigningIn" @click="auth.signInWithApple">
      {{ t('auth.signInWithApple') }}
    </Button>

    <p v-if="auth.errorMessage" class="text-[11px] text-destructive">{{ auth.errorMessage }}</p>
  </div>
</template>
