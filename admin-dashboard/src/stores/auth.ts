import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  GoogleAuthProvider,
  OAuthProvider,
  type User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { firebaseAuth } from '@/lib/firebase'

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<User | null>(firebaseAuth.currentUser)
  const isSigningIn = ref(false)
  const errorMessage = ref<string | null>(null)
  let initialized = false

  /** main.tsから一度だけ呼ぶ。以後 currentUser は自動的に追従する。 */
  function init() {
    if (initialized) return
    initialized = true
    onAuthStateChanged(firebaseAuth, (user) => {
      currentUser.value = user
    })
  }

  async function signInWithGoogle() {
    errorMessage.value = null
    isSigningIn.value = true
    try {
      await signInWithPopup(firebaseAuth, new GoogleAuthProvider())
    } catch (e) {
      errorMessage.value = `Googleサインインエラー: ${(e as Error).message}`
    } finally {
      isSigningIn.value = false
    }
  }

  async function signInWithApple() {
    errorMessage.value = null
    isSigningIn.value = true
    try {
      // Firebase Console側でApple providerの設定(Service ID等)が済んでいる必要がある
      await signInWithPopup(firebaseAuth, new OAuthProvider('apple.com'))
    } catch (e) {
      errorMessage.value = `Appleサインインエラー: ${(e as Error).message}`
    } finally {
      isSigningIn.value = false
    }
  }

  async function signOut() {
    await firebaseSignOut(firebaseAuth)
  }

  function clearError() {
    errorMessage.value = null
  }

  return {
    currentUser,
    isSigningIn,
    errorMessage,
    init,
    signInWithGoogle,
    signInWithApple,
    signOut,
    clearError,
  }
})
