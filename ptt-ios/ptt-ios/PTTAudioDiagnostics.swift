//
//  PTTAudioDiagnostics.swift
//  ptt-ios
//
//  [診断用] Bluetoothヘッドセット(Elecom LBT-HS11)のボタンがどのアプリに渡っているか
//  切り分けるため、LiveKit接続前後・送話開始/終了のタイミングでAVAudioSessionの
//  実際の設定値をログに出す。PTTConnectionManager.swift・PTTBackgroundControlManager.swift・
//  ptt_iosApp.swiftの複数箇所から呼ばれる想定で、依存関係をわかりやすくするために
//  単独ファイルへ切り出した。
//
//  [CallKit統合を撤回(2026-07-30)] 原因はHFP接続のBluetoothヘッドセットの物理ボタンが
//  CallKit経由でないと信号が届かないこと、と特定済み(PTTCallKitManager.swiftで対応した
//  実績あり)。ただしCallKit統合はアプリの自動前面化という副作用があったため一旦撤回した。
//  現在このファイルはどこからも呼ばれていない未使用コードだが、CallKit再検討時に
//  再利用できるよう残してある。
//

import Foundation
import AVFAudio

func logCurrentAudioSession(context: String) {
    let s = AVAudioSession.sharedInstance()
    print("🔊[\(context)] category=\(s.category.rawValue) mode=\(s.mode.rawValue) " +
          "options=\(s.categoryOptions.rawValue) isOtherAudioPlaying=\(s.isOtherAudioPlaying) " +
          "route.outputs=\(s.currentRoute.outputs.map { $0.portType.rawValue }) " +
          "route.inputs=\(s.currentRoute.inputs.map { $0.portType.rawValue })")
}
