//
//  PTTBackgroundControlManager.swift
//  ptt-ios
//
//  [Phase9 バックグラウンド動作]
//  Info.plistのUIBackgroundModes=audio + AVAudioSession(.playAndRecord/.voiceChat)により、
//  アプリをバックグラウンドに回してもLiveKit経由の音声送受信自体はプロセスが生きている限り
//  継続できる(Android版と異なり、iOSにはこれに相当するForegroundServiceの概念は不要)。
//
//  一方、画面上のPTTボタンはアプリが前面にある間しか押せないため、バックグラウンド中に
//  「送話を開始/終了する」操作を行う手段が別途必要になる。このクラスはその手段を提供する:
//
//    1. MPRemoteCommandCenter経由のロック画面/コントロールセンターの再生系コントロール
//       (Now Playing風UI)。play=送話開始、pause=送話終了として割り当てる
//    2. Bluetoothヘッドセット等の物理ボタン(シングルクリック)も同じMPRemoteCommandCenter経由で
//       play/pauseコマンドとして届くため、1と同じ経路で扱える
//
//  Androidの物理ボタン実装(PTTForegroundService.kt)とは異なり、iOSのMPRemoteCommandCenterは
//  ボタンのdown/upを個別に受け取れず「1回の操作」としてしか通知されないため、
//  画面上のPTTボタンと同じ「押している間だけ送話」(hold-to-talk)は再現できない。
//  そのため、いずれの操作手段も「タップ(1回操作)でトグル」という統一UXにしている
//  (Android側もヘッドセット物理ボタン以外は同じ考え方)。
//
//  [常駐通知(UNNotification)を廃止した経緯]
//  当初はNow Playingウィジェットに加えて「送話開始/送話終了」アクション付きの常駐通知も
//  併設していたが、以下の理由により廃止し、Now Playingウィジェットへ一本化した。
//    - 誰かが送話を開始/終了するたびに内容を更新する設計だったため、interruptionLevelを
//      .passiveにしてもロック画面の通知一覧に残り続け、Now Playingウィジェットと機能が
//      完全に重複する形でユーザーの目に触れ続けてしまっていた
//    - 送話開始/終了の操作自体はNow Playingウィジェットの再生/一時停止で既に行えており、
//      常駐通知側のアクションボタンは同じ操作を別の見た目で提供しているだけだった
//
//  [制約・注意]
//  - 実機での動作検証(ロック画面からの操作・長時間バックグラウンド時の接続維持・
//    Bluetoothヘッドセットとの実際の挙動)はこのドキュメント作成時点では未実施。
//  - MPNowPlayingInfoCenterを使うため、他のNow Playing表示(ミュージックアプリ等)と
//    競合して見た目上入れ替わることがある。これはPTT用途でこの仕組みを流用する場合の
//    一般的なトレードオフ。
//

import Foundation
import Combine
import MediaPlayer
import AVFoundation

@MainActor
final class PTTBackgroundControlManager: NSObject, ObservableObject {

    private weak var connection: PTTConnectionManager?
    private var cancellables = Set<AnyCancellable>()

    /// ContentView.swift から一度だけ呼ぶ。connection は @StateObject として
    /// ContentView側が生存管理するため、ここではweak参照のみ保持する。
    func attach(to connection: PTTConnectionManager) {
        guard self.connection == nil else { return }
        self.connection = connection

        configureRemoteCommands()
        observeConnectionState()
        observeAudioInterruptions()
    }

    // MARK: - MPRemoteCommandCenter(ロック画面・コントロールセンター・ヘッドセットボタン)

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            guard let connection = self?.connection else { return .commandFailed }
            connection.startTalking()
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            guard let connection = self?.connection else { return .commandFailed }
            connection.stopTalking()
            return .success
        }
        // 片耳Bluetoothヘッドセットのシングルクリック等、play/pauseではなく
        // トグル1コマンドとして届く経路もあるため、送話中かどうかで出し分ける。
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self, let connection = self.connection else { return .commandFailed }
            if connection.isSending {
                connection.stopTalking()
            } else {
                connection.startTalking()
            }
            return .success
        }

        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        // PTTでは意味を持たない操作は明示的に無効化しておく(コントロールセンターに
        // 表示されてもタップされないよう、可能な範囲でOS側に伝える)。
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
        center.changePlaybackPositionCommand.isEnabled = false
        center.stopCommand.isEnabled = false
    }

    private func updateNowPlayingInfo(status: ConnectionStatus, isSending: Bool) {
        switch status {
        case .connected(let room), .reconnecting(let room):
            var info: [String: Any] = [:]
            info[MPMediaItemPropertyTitle] = room
            info[MPMediaItemPropertyArtist] = String(localized: "PTT接続中")
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = 0.0
            info[MPNowPlayingInfoPropertyPlaybackRate] = isSending ? 1.0 : 0.0
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            MPNowPlayingInfoCenter.default().playbackState = isSending ? .playing : .paused
        case .disconnected, .connecting, .error:
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            MPNowPlayingInfoCenter.default().playbackState = .stopped
        }
    }

    // MARK: - 接続状態の購読 → Now Playing情報の更新

    private func observeConnectionState() {
        guard let connection else { return }
        connection.$status
            .combineLatest(connection.$isSending)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status, isSending in
                self?.updateNowPlayingInfo(status: status, isSending: isSending)
            }
            .store(in: &cancellables)
    }

    // MARK: - オーディオ割り込み(電話着信等)

    private func observeAudioInterruptions() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification, object: nil
        )
    }

    @objc private func handleAudioInterruption(_ notification: Foundation.Notification) {
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            // 電話着信等でオーディオセッションを奪われた。送話中のまま放置すると
            // マイクが有効なのに実際には送信できない不整合な状態になりうるため、
            // 安全側に倒して送話を止める(送話ロックもtalk/stopで解放される)。
            connection?.stopTalking()
        case .ended:
            guard let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt else { return }
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
            if options.contains(.shouldResume) {
                try? AVAudioSession.sharedInstance().setActive(true)
            }
        @unknown default:
            break
        }
    }
}
