/**
 * PTTAuthManager.kt
 *
 * [Firebase Auth対応]
 * Web版/iOS版と同じFirebaseプロジェクトに対してGoogleサインインを行い、
 * token-serverへのリクエストに必要なFirebase ID Tokenを供給する。
 *
 * token-server側は全エンドポイントで `Authorization: Bearer <ID Token>` を
 * 必須にしているため(routes/token.js の requireFirebaseAuth)、これが無いと
 * /token は401になる。
 *
 * Google Sign-InのUI起動(Intent)自体はActivity側(MainActivity)が
 * ActivityResultLauncherで行い、結果だけをこのクラスに渡す設計にしている
 * (このクラス自体はActivity/Contextのライフサイクルに依存させないため)。
 */
package co.ubunifu.pttandroid.auth

import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.tasks.Task
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.tasks.await

class PTTAuthManager(context: Context, webClientId: String) {

    private val auth: FirebaseAuth = FirebaseAuth.getInstance()

    private val googleSignInClient: GoogleSignInClient by lazy {
        val options = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(webClientId)
            .requestEmail()
            .build()
        GoogleSignIn.getClient(context.applicationContext, options)
    }

    private val _currentUser = MutableStateFlow(auth.currentUser)
    val currentUser: StateFlow<FirebaseUser?> = _currentUser

    private val _lastErrorMessage = MutableStateFlow<String?>(null)
    val lastErrorMessage: StateFlow<String?> = _lastErrorMessage

    init {
        auth.addAuthStateListener { a -> _currentUser.update { a.currentUser } }
    }

    val displayName: String?
        get() = _currentUser.value?.displayName ?: _currentUser.value?.email

    fun clearError() {
        _lastErrorMessage.value = null
    }

    /** MainActivityがActivityResultLauncherへ渡すためのサインインIntent */
    fun signInIntent(): Intent = googleSignInClient.signInIntent

    /**
     * ActivityResultLauncherのコールバック内から呼ぶ。
     * GoogleサインインのIDトークンをFirebaseのクレデンシャルに変換し、Firebase Authへサインインする。
     */
    suspend fun handleSignInResult(data: Intent?) {
        try {
            val task: Task<com.google.android.gms.auth.api.signin.GoogleSignInAccount> =
                GoogleSignIn.getSignedInAccountFromIntent(data)
            val account = task.await()
            val idToken = account.idToken
            if (idToken == null) {
                _lastErrorMessage.value = "Googleサインインからトークンを取得できませんでした"
                return
            }
            val credential = GoogleAuthProvider.getCredential(idToken, null)
            auth.signInWithCredential(credential).await()
        } catch (e: Exception) {
            _lastErrorMessage.value = "サインインエラー: ${e.message}"
        }
    }

    fun signOut() {
        auth.signOut()
        googleSignInClient.signOut()
    }

    /**
     * token-server呼び出し用の有効なFirebase ID Tokenを取得する。
     * Firebase SDKが期限切れ間近のトークンを検知して自動的にリフレッシュしてくれるため、
     * 呼び出し側は毎回これを呼ぶだけでよい。
     */
    suspend fun fetchIdToken(): String {
        val user = auth.currentUser ?: throw IllegalStateException("サインインしていません")
        val result = user.getIdToken(false).await()
        return result.token ?: throw IllegalStateException("ID Tokenの取得に失敗しました")
    }
}
