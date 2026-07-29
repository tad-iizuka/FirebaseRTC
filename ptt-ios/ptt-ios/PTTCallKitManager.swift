//
//  PTTCallKitManager.swift
//  ptt-ios
//
//  [CallKit統合]
//  Elecom LBT-HS11等、HFP接続のBluetoothヘッドセットの物理ボタンは「電話の応答/終了」用の
//  信号として送出される。対応する CXCall がOS側に存在しないとその信号は行き場を失い、
//  PTTアプリのMPRemoteCommandCenterにも一切届かない(実機検証で確認済み)。そのため、
//  PTTのRoom入室を「発信して即接続済みになった通話」としてCXProvider経由でOSに申告し、
//  物理ボタンの操作を CXEndCallAction として受け取る(reportNewIncomingCallは着信音・
//  着信UIが出てしまうため使わない)。
//
//  ボタン1回の押下はCXEndCallActionとして1回だけ届く。これをfulfillするとCallKit上の
//  「通話」自体が終了し、再申告しない限り次のボタン押下を拾えなくなるため、押下のたびに
//  送話状態をトグルしたうえで即座に新しい「通話」として再申告し、以降の操作も引き続き
//  拾えるようにしている。
//
//  LiveKit側は ptt_iosApp.swift で isAutomaticConfigurationEnabled = false 済み。
//  CallKitの didActivate/didDeactivate に合わせて AudioManager.shared.setEngineAvailability
//  を切り替え、LiveKitの音声エンジン起動タイミングをCallKitのオーディオセッション
//  アクティブ化と揃えている(公式のCallKit統合例に準拠)。
//
//  [Info.plist / Capabilities]
//  Signing & Capabilities に "Background Modes" → "Voice over IP" の追加が必要。
//

import Foundation
import CallKit
import AVFAudio
import LiveKit
import Combine

@MainActor
final class PTTCallKitManager: NSObject, ObservableObject {

    private let provider: CXProvider
    private let callController = CXCallController()
    private weak var connection: PTTConnectionManager?
    private var cancellables = Set<AnyCancellable>()

    /// 現在CallKitに「通話中」として申告しているUUID。nilなら申告していない状態。
    private var activeCallUUID: UUID?

    override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = false
        // CXEndCallAction後に即座に新しい通話を再申告する設計のため、古い通話が
        // CallKit内部で完全に片付く前に新しい通話が追加されようとして
        // maximumCallGroupsReachedで失敗する競合が起きうる。1つ余裕を持たせる。
        config.maximumCallGroups = 2
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        // 電話帳との統合は不要(PTTはRoom名を表示するだけでよい)。
        config.includesCallsInRecents = false
        self.provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    /// ContentView.swift から一度だけ呼ぶ。
    func attach(to connection: PTTConnectionManager) {
        guard self.connection == nil else { return }
        self.connection = connection

        connection.$status
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                self?.handleStatusChange(status)
            }
            .store(in: &cancellables)
    }

    private func handleStatusChange(_ status: ConnectionStatus) {
        switch status {
        case .connected:
            reportCallStartedIfNeeded()
        case .disconnected, .error:
            endReportedCallIfNeeded()
        case .connecting, .reconnecting:
            break
        }
    }

    // MARK: - 通話の申告(発信 → 即接続済み)

    private func reportCallStartedIfNeeded(retryOnFailure: Bool = true) {
        guard activeCallUUID == nil else { return }
        let uuid = UUID()
        activeCallUUID = uuid

        let handle = CXHandle(type: .generic, value: "PTT")
        let startCallAction = CXStartCallAction(call: uuid, handle: handle)
        startCallAction.isVideo = false
        let transaction = CXTransaction(action: startCallAction)

        callController.request(transaction) { [weak self] error in
            if let error {
                Task { @MainActor in
                    guard let self else { return }
                    self.activeCallUUID = nil
                    if retryOnFailure {
                        // 直前のCXEndCallActionの後始末がCallKit内部でまだ終わっていない
                        // 場合に失敗することがあるため、少し待って一度だけ再試行する。
                        try? await Task.sleep(nanoseconds: 200_000_000)
                        self.reportCallStartedIfNeeded(retryOnFailure: false)
                    }
                }
                return
            }
            // 発信 → ダイヤル中を経ずに即「接続済み」として報告する。
            // (PTTは実際にはすでに接続済みのRoomに対して通話ラベルを後付けしているだけなので)
            self?.provider.reportOutgoingCall(with: uuid, startedConnectingAt: nil)
            self?.provider.reportOutgoingCall(with: uuid, connectedAt: Date())
        }
    }

    private func endReportedCallIfNeeded() {
        guard let uuid = activeCallUUID else { return }
        activeCallUUID = nil
        let endCallAction = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: endCallAction)
        callController.request(transaction) { _ in }
    }
}

// MARK: - CXProviderDelegate

extension PTTCallKitManager: CXProviderDelegate {

    nonisolated func providerDidReset(_ provider: CXProvider) {
        Task { @MainActor in
            self.activeCallUUID = nil
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        action.fulfill()
    }

    /// Bluetoothヘッドセットの物理ボタン操作はここに届く。ボタン1回押下＝1イベントなので、
    /// 送話中かどうかでstart/stopをトグルする。
    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        Task { @MainActor in
            guard let connection = self.connection else {
                action.fulfill()
                return
            }
            if connection.isSending {
                connection.stopTalking()
            } else {
                connection.startTalking()
            }
            action.fulfill()
            self.activeCallUUID = nil
            if case .connected = connection.status {
                self.reportCallStartedIfNeeded()
            }
        }
    }

    /// 「新しい通話を都度再登録する」設計の副作用として発火することがあるため、
    /// 送話状態には影響させない(実際のボタン操作はCXEndCallAction側で処理される)。
    nonisolated func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        action.fulfill()
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        action.fulfill()
    }

    nonisolated func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        do {
            try audioSession.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try AudioManager.shared.setEngineAvailability(.default)
            // [訂正] エンジンが実際に利用可能になったのはここが最初のタイミングなので、
            // keep-aliveトラック(マイクをmuted状態でpublish。Egress起動に必要な
            // 「最低1トラック」要件対応)のpublishもここで行う。以前は
            // PTTConnectionManager.connect() が接続直後・エンジンがまだ.noneの状態で
            // 行っており、これが不安定さの原因だった。
            Task { @MainActor in
                self.connection?.publishKeepAliveAudioTrackIfNeeded()
            }
        } catch {
            print("PTTCallKitManager didActivate configuration error: \(error)")
        }
    }

    nonisolated func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        try? AudioManager.shared.setEngineAvailability(.none)
    }
}
