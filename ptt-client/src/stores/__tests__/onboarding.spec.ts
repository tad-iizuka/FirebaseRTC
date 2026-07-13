import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useOnboardingStore } from '@/stores/onboarding'

describe('onboarding store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to not completed for a first-time visitor', () => {
    const store = useOnboardingStore()
    expect(store.hasCompletedOnboarding).toBe(false)
  })

  it('persists completion across store instances (same localStorage)', async () => {
    const store = useOnboardingStore()
    store.complete()
    expect(store.hasCompletedOnboarding).toBe(true)

    // useStorage(VueUse)のlocalStorageへの書き込みはVueのリアクティビティの
    // フラッシュ(nextTick)を待ってから行われるため、同期的に読み直すと反映前を
    // 拾ってしまう。実際のアプリでも「complete() 直後」に即リロードする以外は
    // 問題にならないタイミングだが、テストとしては明示的に待つ。
    await nextTick()

    // 新しいPiniaインスタンスでも、localStorageが同じなら状態が引き継がれる
    setActivePinia(createPinia())
    const reloaded = useOnboardingStore()
    expect(reloaded.hasCompletedOnboarding).toBe(true)
  })

  it('reset() clears completion (developer/debug use)', () => {
    const store = useOnboardingStore()
    store.complete()
    store.reset()
    expect(store.hasCompletedOnboarding).toBe(false)
  })
})
