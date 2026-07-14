import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'rooms',
      component: () => import('@/views/RoomsListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/rooms/:roomId',
      name: 'room-detail',
      component: () => import('@/views/RoomDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // [Phase8] 監査ログ閲覧(audit:read権限が必要。token-server/routes/admin.js)
      path: '/audit-logs',
      name: 'audit-logs',
      component: () => import('@/views/AuditLogsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // [Phase8] 管理者権限の一覧・付与/剥奪(admins:manage権限が必要)
      path: '/admins',
      name: 'admins',
      component: () => import('@/views/AdminsView.vue'),
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
  // ルート自体で弾く必要はない。Firebase Authのセッション復元を待つだけ。
  if (to.meta.requiresAuth && authReady) {
    await authReady
  }
  return true
})

export default router
