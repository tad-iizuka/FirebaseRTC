package co.ubunifu.pttandroid

import android.app.Application
import com.google.firebase.FirebaseApp

/**
 * PTTApplication
 *
 * google-services.json (Firebase Consoleからダウンロード。app/直下に配置)を読み込んで
 * Firebaseを初期化する。iOS版のGoogleService-Info.plist読み込み(ptt_iosApp.swift)に相当。
 * このファイルはリポジトリには含めない(.gitignore参照)。
 */
class PTTApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        FirebaseApp.initializeApp(this)
    }
}
