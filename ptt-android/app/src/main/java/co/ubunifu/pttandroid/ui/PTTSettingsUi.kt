/**
 * PTTSettingsUi.kt
 *
 * [設定アイコン・設定ダイアログ]
 * Web版(ptt-client/src/components/SettingsIcon.vue・SettingsDialog.vue)・
 * iOS版(PTTSettingsIcon.swift・PTTSettingsView.swift)の移植。
 * HeaderRowに常時表示することで、未サインイン/サインイン後どちらの画面からも
 * 同じ設定(現状はサーバー接続先のみ)へたどり着けるようにする。
 */
package co.ubunifu.pttandroid.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.ubunifu.pttandroid.R
import co.ubunifu.pttandroid.settings.PTTServerPreset
import co.ubunifu.pttandroid.settings.PTTSettingsStore
import co.ubunifu.pttandroid.ui.theme.PTTColors

private val Mono = FontFamily.Monospace
private val IconBadgeSize = 28.dp

@Composable
fun SettingsIcon(settingsStore: PTTSettingsStore) {
    var open by remember { mutableStateOf(false) }
    val label = stringResource(R.string.settings_title)

    Box(
        Modifier
            .size(IconBadgeSize)
            .clip(CircleShape)
            .background(PTTColors.Panel)
            .border(BorderStroke(1.dp, PTTColors.Line), CircleShape)
            .clickable { open = true }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_settings_gear),
            contentDescription = null,
            tint = PTTColors.Muted,
            modifier = Modifier.size(14.dp),
        )
    }

    if (open) {
        SettingsDialog(settingsStore = settingsStore, onDismiss = { open = false })
    }
}

/**
 * [モバイルUI再編・2026-08-04] 設定タブ内の「接続設定(サーバー/LiveKit)」行。
 * iOS版connectionSettingsSectionの移植。従来はヘッダーの歯車アイコン(SettingsIcon、
 * 上記)から即シート表示していたが、設定タブ内の通常行としても同じダイアログ
 * (SettingsDialog)を開けるようにする。ダイアログ自体は変更なく共有する。
 */
@Composable
fun ConnectionSettingsRow(settingsStore: PTTSettingsStore) {
    var open by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { open = true }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_settings_gear),
            contentDescription = null,
            tint = PTTColors.Muted,
            modifier = Modifier.size(16.dp),
        )
        Text(
            stringResource(R.string.settings_connection_row_label),
            fontFamily = Mono,
            fontSize = 12.sp,
            modifier = Modifier.weight(1f),
        )
        Text("\u203A", fontFamily = Mono, fontSize = 14.sp, color = PTTColors.Muted)
    }

    if (open) {
        SettingsDialog(settingsStore = settingsStore, onDismiss = { open = false })
    }
}

/**
 * サーバー接続設定ダイアログ。開いている間はローカルの下書き(draft*)で編集し、
 * 「実行する」を押すまでストア(PTTSettingsStore)へは反映しない
 * (Web版SettingsDialog.vueの下書き方式と同じ)。
 */
@Composable
private fun SettingsDialog(settingsStore: PTTSettingsStore, onDismiss: () -> Unit) {
    val presetId by settingsStore.presetId.collectAsState()
    val customTokenServerUrl by settingsStore.customTokenServerUrl.collectAsState()
    val customLivekitUrl by settingsStore.customLivekitUrl.collectAsState()

    var draftPreset by remember { mutableStateOf(presetId) }
    var draftTokenServerUrl by remember { mutableStateOf(customTokenServerUrl) }
    var draftLivekitUrl by remember { mutableStateOf(customLivekitUrl) }

    val isTokenServerUrlValid = draftPreset != PTTServerPreset.CUSTOM || draftTokenServerUrl.trim().startsWith("https://")
    val isLivekitUrlValid = draftPreset != PTTServerPreset.CUSTOM || draftLivekitUrl.trim().startsWith("wss://")
    val canSave = isTokenServerUrlValid && isLivekitUrlValid

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_title), fontFamily = Mono) },
        text = {
            Column {
                Text(
                    stringResource(R.string.settings_server_section),
                    fontFamily = Mono,
                    fontSize = 10.sp,
                    color = PTTColors.Muted,
                )
                PresetRow(
                    label = stringResource(R.string.settings_preset_production),
                    selected = draftPreset == PTTServerPreset.PRODUCTION,
                    onClick = { draftPreset = PTTServerPreset.PRODUCTION },
                )
                PresetRow(
                    label = stringResource(R.string.settings_preset_custom),
                    selected = draftPreset == PTTServerPreset.CUSTOM,
                    onClick = { draftPreset = PTTServerPreset.CUSTOM },
                )

                if (draftPreset == PTTServerPreset.CUSTOM) {
                    OutlinedTextField(
                        value = draftTokenServerUrl,
                        onValueChange = { draftTokenServerUrl = it },
                        label = { Text(stringResource(R.string.auth_token_server_url), fontFamily = Mono, fontSize = 11.sp) },
                        isError = !isTokenServerUrlValid,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (!isTokenServerUrlValid) {
                        Text(
                            stringResource(R.string.settings_invalid_token_server_url),
                            color = PTTColors.Danger,
                            fontFamily = Mono,
                            fontSize = 11.sp,
                        )
                    }
                    OutlinedTextField(
                        value = draftLivekitUrl,
                        onValueChange = { draftLivekitUrl = it },
                        label = { Text(stringResource(R.string.auth_livekit_url), fontFamily = Mono, fontSize = 11.sp) },
                        isError = !isLivekitUrlValid,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (!isLivekitUrlValid) {
                        Text(
                            stringResource(R.string.settings_invalid_livekit_url),
                            color = PTTColors.Danger,
                            fontFamily = Mono,
                            fontSize = 11.sp,
                        )
                    }
                }

                Text(
                    stringResource(R.string.settings_effect_hint),
                    fontFamily = Mono,
                    fontSize = 11.sp,
                    color = PTTColors.Muted,
                )

                TextButton(onClick = {
                    draftPreset = PTTServerPreset.PRODUCTION
                    draftTokenServerUrl = PTTSettingsStore.PRODUCTION_TOKEN_SERVER_URL
                    draftLivekitUrl = PTTSettingsStore.PRODUCTION_LIVEKIT_URL
                }) {
                    Text(stringResource(R.string.settings_reset_to_default), fontFamily = Mono)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = canSave,
                onClick = {
                    settingsStore.save(draftPreset, draftTokenServerUrl.trim(), draftLivekitUrl.trim())
                    onDismiss()
                },
            ) {
                Text(stringResource(R.string.common_confirm), fontFamily = Mono)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.common_cancel), fontFamily = Mono)
            }
        },
    )
}

@Composable
private fun PresetRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Text(label, fontFamily = Mono, fontSize = 12.sp)
    }
}
