<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore, PRESETS } from '@/stores/settings'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'

// [設定ダイアログ]
// 未ログイン画面(AuthView)・ログイン後どちらからも同じダイアログを開けるよう、
// AppHeaderに常時表示する歯車アイコン(SettingsIcon.vue)からopenを制御してもらう形にする。
// 接続先の変更はここでのみ行い、AuthView側からは入力フィールドを撤去した。
const { t } = useI18n()
const settings = useSettingsStore()

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

// ダイアログを開いている間だけ編集するローカルの下書き。
// 「保存」を押すまでストアへ反映しないことで、閉じずにEscで
// キャンセルした場合に元の値へ戻せるようにする。
const draftPresetId = ref(settings.presetId)
const draftTokenServerUrl = ref(settings.customTokenServerUrl)
const draftLivekitUrl = ref(settings.customLivekitUrl)

watch(
  () => settings.presetId,
  () => {
    draftPresetId.value = settings.presetId
    draftTokenServerUrl.value = settings.customTokenServerUrl
    draftLivekitUrl.value = settings.customLivekitUrl
  },
)

// ダイアログを開くたびに、ストアの現在値を下書きへ再同期する
// (前回キャンセルした入力が残ったまま次回開くのを防ぐ)
function syncDraftFromStore() {
  draftPresetId.value = settings.presetId
  draftTokenServerUrl.value = settings.customTokenServerUrl
  draftLivekitUrl.value = settings.customLivekitUrl
}

// [簡易バリデーション]
// token-server側にヘルスチェックAPIが存在しないため、実際の疎通確認は今回のスコープ外。
// タイプミスによる事故を減らす最低限のガードとして、スキームだけチェックする。
const isTokenServerUrlValid = computed(
  () => draftPresetId.value !== 'custom' || /^https:\/\/.+/.test(draftTokenServerUrl.value.trim()),
)
const isLivekitUrlValid = computed(
  () => draftPresetId.value !== 'custom' || /^wss:\/\/.+/.test(draftLivekitUrl.value.trim()),
)
const canSave = computed(() => isTokenServerUrlValid.value && isLivekitUrlValid.value)

function handleSave() {
  if (!canSave.value) return
  settings.presetId = draftPresetId.value
  if (draftPresetId.value === 'custom') {
    settings.customTokenServerUrl = draftTokenServerUrl.value.trim()
    settings.customLivekitUrl = draftLivekitUrl.value.trim()
  }
  emit('close')
}

function handleResetToDefault() {
  draftPresetId.value = 'production'
  draftTokenServerUrl.value = PRESETS.production.tokenServerUrl
  draftLivekitUrl.value = PRESETS.production.livekitUrl
}

function handleCancel() {
  syncDraftFromStore()
  emit('close')
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    @keydown.esc="handleCancel"
  >
    <Card class="w-full max-w-sm p-5">
      <h2 class="mb-4 text-sm font-semibold">{{ t('settings.title') }}</h2>

      <div class="grid gap-3.5">
        <div class="grid gap-1.5">
          <span class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {{ t('settings.serverSection') }}
          </span>

          <label class="flex items-center gap-2 text-xs">
            <input v-model="draftPresetId" type="radio" value="production" />
            {{ t('settings.presetProduction') }}
          </label>
          <label class="flex items-center gap-2 text-xs">
            <input v-model="draftPresetId" type="radio" value="custom" />
            {{ t('settings.presetCustom') }}
          </label>
        </div>

        <template v-if="draftPresetId === 'custom'">
          <div class="grid gap-1">
            <label for="settingsTokenServerUrl" class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {{ t('auth.tokenServerUrl') }}
            </label>
            <Input id="settingsTokenServerUrl" v-model="draftTokenServerUrl" />
            <p v-if="!isTokenServerUrlValid" class="text-[11px] text-destructive">
              {{ t('settings.invalidTokenServerUrl') }}
            </p>
          </div>
          <div class="grid gap-1">
            <label for="settingsLivekitUrl" class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {{ t('auth.livekitUrl') }}
            </label>
            <Input id="settingsLivekitUrl" v-model="draftLivekitUrl" />
            <p v-if="!isLivekitUrlValid" class="text-[11px] text-destructive">
              {{ t('settings.invalidLivekitUrl') }}
            </p>
          </div>
        </template>

        <p class="text-[11px] text-muted-foreground">{{ t('settings.effectHint') }}</p>
      </div>

      <div class="mt-5 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" @click="handleResetToDefault">
          {{ t('settings.resetToDefault') }}
        </Button>
        <div class="flex gap-2">
          <Button variant="secondary" size="sm" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button size="sm" :disabled="!canSave" @click="handleSave">{{ t('common.confirm') }}</Button>
        </div>
      </div>
    </Card>
  </div>
</template>
