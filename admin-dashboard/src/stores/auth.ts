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
import { authedFetch } from '@/lib/api'

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<User | null>(firebaseAuth.currentUser)
  const isSigningIn = ref(false)
  const errorMessage = ref<string | null>(null)
  let initialized = false

  // [2026-07-31 追加、item3(論点5)対応]
  // サインイン済みでも「権限を1つも持っていない」場合はNavTabs自体を
  // 出さないためのゲート。以前は auth.currentUser の有無だけで画面を
  // 出し分けており、任意のGoogleアカウントでサインインするだけで
  // メニュー構成が見えてしまっていた(詳細はbrushup-plan.md 二十六訂参照)。
  const permissions = ref<string[] | null>(null) // null = 未取得
  const isLoadingPermissions = ref(false)
  // [組織ロースター層、実装着手 2026-08-01] 自分がorgRole:'admin'として
  // 名簿登録されている団体のorgId一覧。GET /admin/me が返す。
  const managedOrgIds = ref<string[]>([])

  /** main.tsから一度だけ呼ぶ。以後 currentUser は自動的に追従する。 */
  function init() {
    if (initialized) return
    initialized = true
    onAuthStateChanged(firebaseAuth, (user) => {
      currentUser.value = user
      if (!user) {
        // サインアウト時は権限情報も破棄する(別アカウントでの再サインイン時に
        // 古い権限が一瞬でも見えることを防ぐ)
        permissions.value = null
        managedOrgIds.value = []
      }
    })
  }

  /**
   * GET /admin/me を呼び、自分の権限一覧を取得する。
   * サインイン成功直後にApp.vue側から呼ばれる想定。
   * adminUsers/{uid} が未作成(＝無権限)の場合はサーバー側が空配列を返す。
   */
  async function fetchPermissions(baseUrl: string) {
    isLoadingPermissions.value = true
    try {
      const data = await authedFetch<{ permissions: string[]; managedOrgIds: string[] }>(baseUrl, '/admin/me')
      permissions.value = data.permissions
      managedOrgIds.value = data.managedOrgIds ?? []
    } catch {
      // 取得自体に失敗した場合も「権限なし」として安全側に倒す
      permissions.value = []
      managedOrgIds.value = []
    } finally {
      isLoadingPermissions.value = false
    }
  }

  async function signInWithGoogle() {
    errorMessage.value = null
    isSigningIn.value = true
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(firebaseAuth, provider)
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
    permissions,
    isLoadingPermissions,
    managedOrgIds,
    init,
    signInWithGoogle,
    signInWithApple,
    signOut,
    clearError,
    fetchPermissions,
  }
})
