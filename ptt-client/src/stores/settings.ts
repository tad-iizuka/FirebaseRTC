import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

// Web版で試す先(Cloud Run/LiveKit Cloud)のデフォルト値。
// 開発時に別環境を指すよう書き換えた値はlocalStorageに永続化される。
export const useSettingsStore = defineStore('settings', () => {
  const tokenServerUrl = useStorage('ptt.tokenServerUrl', 'https://ptt-token-server-rnn4fqay3a-an.a.run.app')
  const livekitUrl = useStorage('ptt.livekitUrl', 'wss://ubunifu-talk-wy19xst3.livekit.cloud')

  return { tokenServerUrl, livekitUrl }
})
