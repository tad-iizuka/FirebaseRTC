import { createRouter, createWebHistory } from 'vue-router'

// [画面遷移方針]
// 旧実装(showAuthScreen/showRoomSelectionScreen/showVoiceScreen)の3画面構成を
// そのままルートに対応させる。認証状態はFirebase Authの復元を待つ必要があるため、
// ガードでは「未確定」と「未サインイン」を区別する(復元前にAuthViewへ弾かないようにする)。

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'room-select',
      component: () => import('@/views/RoomSelectView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/room/:roomId',
      name: 'room',
      component: () => import('@/views/RoomView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

let authReady: Promise<void> | null = null

/** main.ts で auth.init() 呼び出し直後に一度だけセットする。 */
export function setAuthReadyPromise(promise: Promise<void>) {
  authReady = promise
}

router.beforeEach(async (to) => {
  // App.vue が「未サインインなら常にAuthViewを描画する」形で分岐するため、
  // ルート自体で弾く必要はない。ここでの役割は、Firebase Authのセッション復元
  // (onAuthStateChangedの初回発火)を待ってから遷移を確定させることだけ。
  // 待たないと、リロード直後に一瞬RoomSelectViewが未サインイン扱いで
  // ちらつく可能性がある。
  if (to.meta.requiresAuth && authReady) {
    await authReady
  }
  return true
})

export default router
