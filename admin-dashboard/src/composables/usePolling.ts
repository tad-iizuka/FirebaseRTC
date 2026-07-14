import { onMounted, onUnmounted } from 'vue'

/**
 * [Phase8] 簡易リアルタイム更新用のポーリングcomposable。
 *
 * クライアントにFirestoreリアルタイムリスナーを直接張らせない
 * (firestore.rulesの「クライアント直接アクセス禁止」方針を維持するため)、
 * token-server経由のポーリングに留めている。本格的な即時反映が必要になった
 * 場合は、token-server側でFirestoreをAdmin SDKで購読しSSEでプッシュする
 * 「サーバー側ファンアウト」構成への切り替えを検討する
 * (token-server/phase8-operations.md参照)。
 *
 * 各Viewのmount時にタイマーを開始し、unmount時に必ず停止する
 * (別タブへ遷移したまま裏でポーリングが動き続けることを防ぐ)。
 */
export function usePolling(callback: () => void, intervalMs = 10000) {
  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    timer = setInterval(callback, intervalMs)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
    timer = null
  })
}
