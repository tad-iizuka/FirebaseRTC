package co.ubunifu.pttandroid.appcheck

import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * PTTAppCheckProvider.kt
 *
 * [Phase14] Firebase App Check対応。token-server側のmiddleware/
 * requireAppCheck.js(soft-enforce)と対になる、Android版の送信側実装。
 * 実機ではPlay Integrityプロバイダを使う(エミュレータ・Play開発者サービス
 * 未インストール環境ではトークン取得自体が失敗しうるが、下記installで
 * try/catchしており、失敗してもアプリの起動自体は妨げない)。
 *
 * [初期化] PTTApplication.onCreate()内、FirebaseApp.initializeApp()の直後に
 * install()を呼ぶ。
 *
 * [利用箇所] 各Store(PTTRoomManager等)がtoken-serverへのリクエスト組み立て
 * 箇所で、idTokenと同様に都度 token() を呼び出す。soft-enforce運用のため、
 * 取得に失敗してもnullを返すだけで例外は投げず、呼び出し側はヘッダーなしで
 * リクエストを継続する。
 */
object PTTAppCheckProvider {
    fun install() {
        try {
            FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
                PlayIntegrityAppCheckProviderFactory.getInstance()
            )
        } catch (e: Exception) {
            android.util.Log.w("PTTAppCheckProvider", "App Checkプロバイダの登録に失敗しました", e)
        }
    }

    suspend fun token(): String? {
        return try {
            suspendCancellableCoroutine { cont ->
                FirebaseAppCheck.getInstance().getAppCheckToken(false)
                    .addOnSuccessListener { result -> cont.resume(result.token) }
                    .addOnFailureListener { e ->
                        android.util.Log.w("PTTAppCheckProvider", "App Checkトークン取得失敗", e)
                        cont.resume(null)
                    }
            }
        } catch (e: Exception) {
            android.util.Log.w("PTTAppCheckProvider", "App Checkトークン取得失敗", e)
            null
        }
    }
}
