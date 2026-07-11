import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

export const useSettingsStore = defineStore('settings', () => {
  const tokenServerUrl = useStorage(
    'ptt.admin.tokenServerUrl',
    'https://ptt-token-server-rnn4fqay3a-an.a.run.app',
  )
  return { tokenServerUrl }
})
