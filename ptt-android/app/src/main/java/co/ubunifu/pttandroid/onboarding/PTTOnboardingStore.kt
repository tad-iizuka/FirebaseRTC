/**
 * PTTOnboardingStore.kt
 *
 * [オンボーディング]
 * Web版(ptt-client/src/stores/onboarding.ts)・iOS版(PTTOnboardingStore.swift)と
 * 同じ設計判断: 初回起動時にアプリの使い方を紹介するスワイプ形式のチュートリアルを
 * 見せたかどうかをSharedPreferencesに永続化する。サインイン前の初回起動者にも
 * 見せたいため、PTTSavedRoomsStoreのようにuidごとにキーを分けず、端末(アプリ)単位で
 * 1つのフラグとして保持する(「このアプリを一度でも起動したか」だけが関心事のため)。
 */
package co.ubunifu.pttandroid.onboarding

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class PTTOnboardingStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("ptt_onboarding", Context.MODE_PRIVATE)

    private val _hasCompletedOnboarding = MutableStateFlow(prefs.getBoolean(KEY_COMPLETED, false))
    val hasCompletedOnboarding: StateFlow<Boolean> = _hasCompletedOnboarding

    fun complete() {
        _hasCompletedOnboarding.value = true
        prefs.edit().putBoolean(KEY_COMPLETED, true).apply()
    }

    /** 開発中の動作確認用。本番UIからは呼ばない想定。 */
    fun reset() {
        _hasCompletedOnboarding.value = false
        prefs.edit().remove(KEY_COMPLETED).apply()
    }

    private companion object {
        const val KEY_COMPLETED = "completed"
    }
}
