import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckTokenRaw } from 'firebase/app-check'
import type { AppCheck } from 'firebase/app-check'

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

// [Phase14: Firebase App Check]
// token-server側のrequireAppCheck(soft-enforce)と対になる、Web版の送信側実装。
// reCAPTCHA v3サイトキーが未設定の環境(ローカル開発でVITE_APP_CHECK_RECAPTCHA_SITE_KEY
// を設定していない場合など)では初期化自体をスキップする。サーバー側は既定でsoft-enforce
// (ヘッダー欠如でも通す)のため、未初期化のままでも機能は壊れない。
//
// ローカル開発でApp Check自体の動作を確認したい場合は、reCAPTCHA v3の本番サイトキーを
// 取得する代わりに、Firebase Consoleでデバッグトークンを発行し、開発時のみ
// `self.FIREBASE_APPCHECK_DEBUG_TOKEN` を有効にする(下記)。本番ビルド(import.meta.env.DEV
// === false)ではデバッグトークンを絶対に有効化しない。
let appCheck: AppCheck | undefined

const recaptchaSiteKey = import.meta.env.VITE_APP_CHECK_RECAPTCHA_SITE_KEY as string | undefined

if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true
}

if (recaptchaSiteKey || import.meta.env.DEV) {
  try {
    appCheck = initializeAppCheck(firebaseApp, {
      // 開発時、サイトキー未設定でもデバッグトークン経由で初期化できるよう
      // ダミー値を渡す(実際に使われるのはデバッグトークンの方)。
      provider: new ReCaptchaV3Provider(recaptchaSiteKey ?? 'dev-debug-token-placeholder'),
      isTokenAutoRefreshEnabled: true,
    })
  } catch (e) {
    console.warn('[AppCheck初期化失敗。App Checkヘッダーなしで継続します]', e)
  }
} else {
  console.warn('[AppCheck未設定] VITE_APP_CHECK_RECAPTCHA_SITE_KEY が未設定のため初期化をスキップしました')
}

/**
 * 現在のApp Checkトークンを取得する。未初期化・取得失敗時はundefinedを返し、
 * 呼び出し側(api.ts の authedFetch)はヘッダーを付けずにリクエストを続行する
 * (soft-enforce運用のため、ここで例外にして機能を止めない)。
 */
export async function getAppCheckToken(): Promise<string | undefined> {
  if (!appCheck) return undefined
  try {
    const result = await getAppCheckTokenRaw(appCheck)
    return result.token
  } catch (e) {
    console.warn('[AppCheckトークン取得失敗]', e)
    return undefined
  }
}
