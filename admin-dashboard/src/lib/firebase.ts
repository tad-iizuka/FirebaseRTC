import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// [Phase1: Firebase Auth]
// このアプリで実際に使っているFirebaseプロジェクトの設定(公開情報。秘密鍵ではない)。
// dev-tools/get-firebase-token.html と同じプロジェクトを指している。
// 本番運用では Vite の環境変数(.env)経由に切り出すことを推奨するが、
// 既存実装(ptt-client/public/index.html)と同じく公開値なのでハードコードでも実害はない。
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyD8TErGVlJFrn3Sldgr3junEvFufz_7wW0',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'fir-rtc-de1f4.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'fir-rtc-de1f4',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const firebaseAuth = getAuth(firebaseApp)
export const firestoreDb = getFirestore(firebaseApp)
