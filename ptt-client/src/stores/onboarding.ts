import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'

// [オンボーディング]
// 初回起動時にアプリの使い方を紹介するスワイプ形式のチュートリアルを
// 表示済みかどうかを永続化する。サインイン前の初回訪問者にも見せたいため、
// authストアのuidには依存させず、デバイス単位でlocalStorageに保持する
// (savedRoomsStoreがuidごとに履歴を分けているのとは異なる設計判断: ここでは
//  「このブラウザで一度でも見たか」だけが関心事のため)。

export const useOnboardingStore = defineStore('onboarding', () => {
  const hasCompletedOnboarding = useStorage('ptt.onboarding.completed', false)

  function complete() {
    hasCompletedOnboarding.value = true
  }

  /** 開発中の動作確認用。UIからは呼ばれない想定(必要ならデバッグメニュー等から)。 */
  function reset() {
    hasCompletedOnboarding.value = false
  }

  return { hasCompletedOnboarding, complete, reset }
})
