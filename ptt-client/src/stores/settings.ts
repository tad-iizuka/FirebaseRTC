import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

// [接続先設定 — 設定画面への移設(2026-07-29)]
// 従来はAuthView(未ログイン画面)に自由入力フィールドとして常時表示していたが、
// 「普段は意識せず、必要な人だけが迷わずたどり着ける」設定として設定画面(SettingsDialog)へ移した。
// 併せて、自由記述によるtypoでログイン不能になる事故を減らすため、
// プリセット選択+カスタム入力の二段構成にした。
// 既知の値は本番(production)のみのため、プリセットは production/custom の2種類。
// 将来ステージング等が増えたら PRESETS にエントリを追加するだけで拡張できる。
export const PRESETS = {
  production: {
    tokenServerUrl: 'https://ptt-token-server-rnn4fqay3a-an.a.run.app',
    livekitUrl: 'wss://ubunifu-talk-wy19xst3.livekit.cloud',
  },
} as const

export type PresetId = keyof typeof PRESETS | 'custom'

export const useSettingsStore = defineStore('settings', () => {
  const presetId = useStorage<PresetId>('ptt.serverPresetId', 'production')
  // カスタム値はプリセットと切り替えても消えないよう独立して永続化する
  // (一度「本番」に戻してから「カスタム」に戻っても、前回入力した値が残る)
  const customTokenServerUrl = useStorage('ptt.customTokenServerUrl', PRESETS.production.tokenServerUrl)
  const customLivekitUrl = useStorage('ptt.customLivekitUrl', PRESETS.production.livekitUrl)

  // 実際に使われる接続先。roomStore/api.ts等、既存の呼び出し側はこれまで通り
  // settings.tokenServerUrl / settings.livekitUrl を読むだけでよい(呼び出し側の変更不要)。
  const tokenServerUrl = computed(() =>
    presetId.value === 'custom' ? customTokenServerUrl.value : PRESETS[presetId.value].tokenServerUrl,
  )
  const livekitUrl = computed(() =>
    presetId.value === 'custom' ? customLivekitUrl.value : PRESETS[presetId.value].livekitUrl,
  )

  function resetToDefault() {
    presetId.value = 'production'
  }

  return {
    presetId,
    customTokenServerUrl,
    customLivekitUrl,
    tokenServerUrl,
    livekitUrl,
    resetToDefault,
  }
})
