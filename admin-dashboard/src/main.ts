import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { onAuthStateChanged } from 'firebase/auth'
import App from '@/App.vue'
import router, { setAuthReadyPromise } from '@/router'
import { firebaseAuth } from '@/lib/firebase'
import { useAuthStore } from '@/stores/auth'
import '@/style.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

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
