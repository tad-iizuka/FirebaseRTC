<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Settings } from '@lucide/vue'
import SettingsDialog from '@/components/SettingsDialog.vue'

// [設定アイコン]
// AppHeaderに常時表示することで、未ログイン/ログイン後どちらの画面からも
// 同じ設定(現状はサーバー接続先のみ)へたどり着けるようにする。
// open状態・SettingsDialogの描画をこのコンポーネント内に閉じ込め、
// AppHeader側は <SettingsIcon /> を置くだけでよいようにしている。
const { t } = useI18n()
const open = ref(false)
</script>

<template>
  <button
    type="button"
    class="flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:bg-white/10"
    :title="t('settings.title')"
    :aria-label="t('settings.title')"
    @click="open = true"
  >
    <Settings class="h-3.5 w-3.5" aria-hidden="true" :stroke-width="2" />
  </button>

  <SettingsDialog :open="open" @close="open = false" />
</template>
