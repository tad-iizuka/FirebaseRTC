import { beforeEach, describe, expect, it } from 'vitest'
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

  it('persists completion across store instances (same localStorage)', () => {
    const store = useOnboardingStore()
    store.complete()
    expect(store.hasCompletedOnboarding).toBe(true)

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
