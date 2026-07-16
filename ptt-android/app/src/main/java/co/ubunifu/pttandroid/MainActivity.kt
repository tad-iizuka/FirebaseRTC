/**
 * MainActivity.kt
 *
 * Web版(ptt-client/public/index.html)・iOS版(ContentView.swift)と同等のUI:
 * (初回起動時のみ)オンボーディング → Googleサインイン → ルーム作成/招待コード参加 →
 * PTTボタン → 送話中リスト → チャット → ログ
 *
 * Google Sign-InのIntent起動とマイク権限リクエストはActivity側の責務のため、
 * ここでActivityResultLauncherを保持し、結果だけを各Managerへ橋渡しする。
 */
package co.ubunifu.pttandroid

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import co.ubunifu.pttandroid.auth.PTTAuthManager
import co.ubunifu.pttandroid.ban.PTTBanStore
import co.ubunifu.pttandroid.chat.PTTChatStore
import co.ubunifu.pttandroid.connection.PTTConnectionManager
import co.ubunifu.pttandroid.onboarding.PTTOnboardingStore
import co.ubunifu.pttandroid.room.PTTRoomManager
import co.ubunifu.pttandroid.room.PTTSavedRoomsStore
import co.ubunifu.pttandroid.ui.PTTApp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var authManager: PTTAuthManager

    private var micPermissionGranted = mutableStateOf(false)

    private val requestMicPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> micPermissionGranted.value = granted }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        authManager = PTTAuthManager(
            context = applicationContext,
            webClientId = getString(R.string.default_web_client_id),
        )

        micPermissionGranted.value = ContextCompat.checkSelfPermission(
            this, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        val signInLauncher = registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->
            lifecycleScope.launch {
                authManager.handleSignInResult(result.data)
            }
        }

        setContent {
            val scope = rememberCoroutineScope()
            val roomManager = remember { PTTRoomManager() }
            val savedRoomsStore = remember { PTTSavedRoomsStore(applicationContext) }
            val connectionManager = remember { PTTConnectionManager(applicationContext, scope) }
            val chatStore = remember { PTTChatStore() }
            val banStore = remember { PTTBanStore() }
            // [オンボーディング] 初回起動時のスワイプ形式チュートリアルの完了状態
            // (SharedPreferencesベース。Web版のonboarding.ts/iOS版のPTTOnboardingStore.swiftと同じ設計)。
            val onboardingStore = remember { PTTOnboardingStore(applicationContext) }

            LaunchedEffect(Unit) {
                if (!micPermissionGranted.value) {
                    requestMicPermission.launch(Manifest.permission.RECORD_AUDIO)
                }
            }

            MaterialTheme {
                Surface {
                    Box {
                        PTTApp(
                            authManager = authManager,
                            roomManager = roomManager,
                            savedRoomsStore = savedRoomsStore,
                            connectionManager = connectionManager,
                            chatStore = chatStore,
                            banStore = banStore,
                            onboardingStore = onboardingStore,
                            onRequestGoogleSignIn = { signInLauncher.launch(authManager.signInIntent()) },
                        )
                    }
                }
            }
        }
    }
}
