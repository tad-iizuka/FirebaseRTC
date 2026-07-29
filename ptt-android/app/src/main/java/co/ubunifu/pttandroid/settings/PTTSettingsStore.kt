/**
 * PTTSettingsStore.kt
 *
 * [接続先設定 — 設定画面への移設(2026-07-29)]
 * 従来はPTTApp内の`remember { mutableStateOf(...) }`としてのみ保持しており、
 * SharedPreferencesへの永続化もされていなかった(プロセス再生成のたびに本番URLへ戻っていた)。
 * Web版(ptt-client/src/stores/settings.ts)・iOS版(PTTSettingsStore.swift)に合わせ、
 *   - プリセット(production/custom)方式にしてtypo事故を減らす
 *   - 端末単位でSharedPreferencesへ永続化する
 *   - 通常画面(AuthSection/RoomSelectionSection)からは撤去し、設定画面へ集約する
 * という3点を揃えた。PTTOnboardingStore.ktと同じ構成(SharedPreferences + StateFlow)。
 * 値そのものはWeb版stores/settings.tsのPRESETS.productionと同じにすること(値を変える場合は
 * 3クライアント同時に変更する)。
 */
package co.ubunifu.pttandroid.settings

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class PTTServerPreset(val storageValue: String) {
    PRODUCTION("production"),
    CUSTOM("custom"),
    ;

    companion object {
        fun fromStorageValue(value: String?): PTTServerPreset =
            entries.firstOrNull { it.storageValue == value } ?: PRODUCTION
    }
}

class PTTSettingsStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("ptt_settings", Context.MODE_PRIVATE)

    private val _presetId = MutableStateFlow(
        PTTServerPreset.fromStorageValue(prefs.getString(KEY_PRESET, null)),
    )
    val presetId: StateFlow<PTTServerPreset> = _presetId

    private val _customTokenServerUrl = MutableStateFlow(
        prefs.getString(KEY_CUSTOM_TOKEN_SERVER_URL, null) ?: PRODUCTION_TOKEN_SERVER_URL,
    )
    val customTokenServerUrl: StateFlow<String> = _customTokenServerUrl

    private val _customLivekitUrl = MutableStateFlow(
        prefs.getString(KEY_CUSTOM_LIVEKIT_URL, null) ?: PRODUCTION_LIVEKIT_URL,
    )
    val customLivekitUrl: StateFlow<String> = _customLivekitUrl

    /** 実際に接続に使う値。呼び出し側はプリセット/カスタムの分岐を意識しなくてよい。 */
    val tokenServerUrl: String
        get() = if (_presetId.value == PTTServerPreset.CUSTOM) _customTokenServerUrl.value else PRODUCTION_TOKEN_SERVER_URL

    val livekitUrl: String
        get() = if (_presetId.value == PTTServerPreset.CUSTOM) _customLivekitUrl.value else PRODUCTION_LIVEKIT_URL

    fun save(presetId: PTTServerPreset, customTokenServerUrl: String, customLivekitUrl: String) {
        _presetId.value = presetId
        prefs.edit().putString(KEY_PRESET, presetId.storageValue).apply()
        if (presetId == PTTServerPreset.CUSTOM) {
            _customTokenServerUrl.value = customTokenServerUrl
            _customLivekitUrl.value = customLivekitUrl
            prefs.edit()
                .putString(KEY_CUSTOM_TOKEN_SERVER_URL, customTokenServerUrl)
                .putString(KEY_CUSTOM_LIVEKIT_URL, customLivekitUrl)
                .apply()
        }
    }

    fun resetToDefault() {
        save(PTTServerPreset.PRODUCTION, _customTokenServerUrl.value, _customLivekitUrl.value)
    }

    companion object {
        const val PRODUCTION_TOKEN_SERVER_URL = "https://ptt-token-server-rnn4fqay3a-an.a.run.app"
        const val PRODUCTION_LIVEKIT_URL = "wss://ubunifu-talk-wy19xst3.livekit.cloud"

        private const val KEY_PRESET = "preset_id"
        private const val KEY_CUSTOM_TOKEN_SERVER_URL = "custom_token_server_url"
        private const val KEY_CUSTOM_LIVEKIT_URL = "custom_livekit_url"
    }
}
