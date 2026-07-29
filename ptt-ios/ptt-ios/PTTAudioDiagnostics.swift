//
//  PTTAudioDiagnostics.swift
//  ptt-ios
//
//  [診断用] Bluetoothヘッドセット(Elecom LBT-HS11)のボタンがどのアプリに渡っているか
//  切り分けるため、LiveKit接続前後・送話開始/終了・CallKitのアクティブ化タイミングで
//  AVAudioSessionの実際の設定値をログに出す。PTTConnectionManager.swift・
//  PTTBackgroundControlManager.swift・PTTCallKitManager.swift・ptt_iosApp.swiftの
//  複数箇所から呼ばれるため、依存関係をわかりやすくするために単独ファイルへ切り出した。
//  原因が完全に特定できたら、このファイルごと削除してよい。
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
