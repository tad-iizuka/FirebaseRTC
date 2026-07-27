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
//  「送話を開始/終了する」操作を行う手段が別途必要になる。このクラスはその手段を3つ提供する:
//
//    1. MPRemoteCommandCenter経由のロック画面/コントロールセンターの再生系コントロール
//       (Now Playing風UI)。play=送話開始、pause=送話終了として割り当てる
//    2. Bluetoothヘッドセット等の物理ボタン(シングルクリック)も同じMPRemoteCommandCenter経由で
//       play/pauseコマンドとして届くため、1と同じ経路で扱える
//    3. アプリがバックグラウンドにいる間だけ表示する常駐通知(UNNotification)。
//       「送話開始」「送話終了」の2アクションを持ち、タップで PTTConnectionManager を操作する
//
//  Androidの物理ボタン実装(PTTForegroundService.kt)とは異なり、iOSのMPRemoteCommandCenterは
//  ボタンのdown/upを個別に受け取れず「1回の操作」としてしか通知されないため、
//  画面上のPTTボタンと同じ「押している間だけ送話」(hold-to-talk)は再現できない。
//  そのため、いずれの操作手段も「タップ(1回操作)でトグル」という統一UXにしている
//  (Android側もヘッドセット物理ボタン以外は同じ考え方)。
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
import UserNotifications
import UIKit
import AVFoundation

private enum PTTNotificationActionId: String {
    case start = "PTT_TALK_START"
    case stop = "PTT_TALK_STOP"
}

@MainActor
final class PTTBackgroundControlManager: NSObject, ObservableObject {

    private static let notificationCategoryId = "PTT_TALK_CONTROL"
    private static let notificationRequestId = "ptt.background.status"

    private weak var connection: PTTConnectionManager?
    private var cancellables = Set<AnyCancellable>()
    private var isAppInBackground = false

    /// ContentView.swift から一度だけ呼ぶ。connection は @StateObject として
    /// ContentView側が生存管理するため、ここではweak参照のみ保持する。
    func attach(to connection: PTTConnectionManager) {
        guard self.connection == nil else { return }
        self.connection = connection

        UNUserNotificationCenter.current().delegate = self
        configureNotificationCategory()
        configureRemoteCommands()
        observeConnectionState()
        observeAppLifecycle()
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

    // MARK: - 接続状態の購読 → Now Playing情報・常駐通知の更新

    private func observeConnectionState() {
        guard let connection else { return }
        connection.$status
            .combineLatest(connection.$isSending, connection.$currentTalkerUid)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status, isSending, talkerUid in
                self?.handleStateChange(status: status, isSending: isSending, talkerUid: talkerUid)
            }
            .store(in: &cancellables)
    }

    private func handleStateChange(status: ConnectionStatus, isSending: Bool, talkerUid: String?) {
        updateNowPlayingInfo(status: status, isSending: isSending)

        // 前面表示中は画面上のPTTボタンで操作できるため、常駐通知は不要(出しっぱなしにしない)。
        guard isAppInBackground else {
            removePersistentNotification()
            return
        }

        switch status {
        case .connected, .reconnecting:
            postOrUpdatePersistentNotification(status: status, isSending: isSending, talkerUid: talkerUid)
        case .disconnected, .connecting, .error:
            removePersistentNotification()
        }
    }

    // MARK: - アプリのフォアグラウンド/バックグラウンド遷移

    private func observeAppLifecycle() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification, object: nil
        )
    }

    @objc private func appDidEnterBackground() {
        isAppInBackground = true
        guard let connection else { return }
        switch connection.status {
        case .connected, .reconnecting:
            requestNotificationAuthorizationIfNeeded { [weak self] granted in
                guard granted, let self, let connection = self.connection else { return }
                self.postOrUpdatePersistentNotification(
                    status: connection.status, isSending: connection.isSending, talkerUid: connection.currentTalkerUid
                )
            }
        case .disconnected, .connecting, .error:
            break
        }
    }

    @objc private func appWillEnterForeground() {
        isAppInBackground = false
        removePersistentNotification()
    }

    // MARK: - 常駐通知(送話開始/終了アクション付き)

    private func configureNotificationCategory() {
        let startAction = UNNotificationAction(
            identifier: PTTNotificationActionId.start.rawValue,
            title: String(localized: "送話開始"),
            options: []
        )
        let stopAction = UNNotificationAction(
            identifier: PTTNotificationActionId.stop.rawValue,
            title: String(localized: "送話終了"),
            options: []
        )
        let category = UNNotificationCategory(
            identifier: Self.notificationCategoryId,
            actions: [startAction, stopAction],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    private func requestNotificationAuthorizationIfNeeded(completion: @escaping (Bool) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional:
                DispatchQueue.main.async { completion(true) }
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                    DispatchQueue.main.async { completion(granted) }
                }
            case .denied, .ephemeral:
                DispatchQueue.main.async { completion(false) }
            @unknown default:
                DispatchQueue.main.async { completion(false) }
            }
        }
    }

    private func postOrUpdatePersistentNotification(status: ConnectionStatus, isSending: Bool, talkerUid: String?) {
        let content = UNMutableNotificationContent()
        switch status {
        case .connected(let room):
            content.title = String(format: NSLocalizedString("接続中: %@", comment: "Background notification title, connected"), room)
        case .reconnecting(let room):
            content.title = String(format: NSLocalizedString("再接続中: %@", comment: "Background notification title, reconnecting"), room)
        case .disconnected, .connecting, .error:
            content.title = String(localized: "PTT接続中")
        }
        if isSending {
            content.body = String(localized: "送話中")
        } else if talkerUid != nil {
            content.body = String(localized: "他の参加者が送話中")
        } else {
            content.body = String(localized: "待機中")
        }
        content.categoryIdentifier = Self.notificationCategoryId
        content.sound = nil

        let request = UNNotificationRequest(identifier: Self.notificationRequestId, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private func removePersistentNotification() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [Self.notificationRequestId])
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.notificationRequestId])
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

// MARK: - UNUserNotificationCenterDelegate(通知アクションのタップをPTTConnectionManagerへ橋渡し)

extension PTTBackgroundControlManager: UNUserNotificationCenterDelegate {

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let actionId = response.actionIdentifier
        Task { @MainActor in
            switch actionId {
            case PTTNotificationActionId.start.rawValue:
                self.connection?.startTalking()
            case PTTNotificationActionId.stop.rawValue:
                self.connection?.stopTalking()
            default:
                break
            }
            completionHandler()
        }
    }

    // アプリがバックグラウンドの間に届く常駐通知は、更新のたびにバナー/サウンドとしても
    // 表示してよい(ここではsoundを設定していないため実質バナー表示のみ)。
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
