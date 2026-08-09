import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { onAuthStateChanged } from 'firebase/auth'
import App from '@/App.vue'
import router, { setAuthReadyPromise } from '@/router'
import { firebaseAuth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/auth'
import { i18n } from '@/i18n'
import '@/style.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(i18n)

// ルーターガードがFirebase Authの初回復元を待てるよう、
// onAuthStateChangedの最初の1回で解決するPromiseを先に登録しておく。
const authReady = new Promise<void>((resolve) => {
  const unsubscribe = onAuthStateChanged(firebaseAuth, () => {
    unsubscribe()
    resolve()
  })
})
setAuthReadyPromise(authReady)

useAuthStore(pinia).init()

app.mount('#app')

// [PWA] Service Worker登録。
// - 本番ビルドのみ登録する。開発サーバー(vite dev)はHMRに依存しており、
//   sw.jsのstale-while-revalidateと相性が悪い（古いモジュールを掴んでしまう）ため
//   import.meta.env.PROD で明示的に除外する。
// - sw.js自体はApp Shell（静的アセット）のみを対象とし、Firestore/LiveKit/
//   token-serverへの通信には介入しない設計。詳細はpublic/sw.jsのコメントを参照。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // 登録失敗はPWA機能（オフラインApp Shell・ホーム画面追加時の挙動改善）が
      // 使えなくなるだけで、アプリ本体の動作(Firestore/LiveKit)には影響しないため
      // 握りつぶしてログ出力のみに留める。
      console.error('[PWA] Service Worker registration failed:', error)
    })
  })
}
