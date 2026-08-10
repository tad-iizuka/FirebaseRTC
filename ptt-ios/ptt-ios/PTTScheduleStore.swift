//
//  PTTScheduleStore.swift
//  PTTClient
//
//  [開始/終了時刻(Schedule)] Web版 stores/room.ts の schedule/scheduleState と
//  startScheduleWaitPolling()の移植。「6. 次アクションの提案」item5
//  (brushup-plan.md)。
//
//  役割: 入室時に渡された初期状態(join/再入室時のfetchRoomNameから得られる
//  schedule/scheduleState)を保持し、before_start(開始前)の間だけ
//  GET /rooms/:roomId/recording/status を15秒間隔でポーリングして、
//  開始時刻に達した(in_session/after_endへ遷移した)ことを検知する。
//  ContentView側はこのストアの`state`をSwiftUIの.onChangeで監視し、
//  before_startから抜けた瞬間にLiveKit接続・チャット購読等の「本来の入室処理」
//  (ContentView.beginSessionIfNeeded)を開始する。
//
//  [他Storeとの役割分担] chat/ban/badges/orgContext等の他Storeとは独立して動作する
//  (Web版のroom.ts同様、schedule自体はどのroleでも同じ扱いのため権限系ロジックは持たない)。
//

import Foundation
import Combine

@MainActor
final class PTTScheduleStore: ObservableObject {

    @Published private(set) var schedule: PTTRoomManager.RoomSchedule?
    @Published private(set) var state: PTTRoomManager.ScheduleState?

    /// Web版 SCHEDULE_WAIT_POLL_INTERVAL_MS と同じ間隔。
    private static let pollIntervalSeconds: TimeInterval = 15

    private var timer: Timer?

    /// 入室時に呼ぶ。joinRoom()または再入室時のfetchRoomName()から得た初期値を渡す。
    /// state == .beforeStart の間はポーリングを開始し、状態が変化するたびに`state`を
    /// 更新する(ContentView側は.onChange(of:)でこれを監視する)。
    /// 再入室等でstateが不明(nil)の場合はポーリングを開始しない
    /// (呼び出し元がfetchRoomName()の結果を待ってから改めてstart()を呼ぶ設計。
    /// ContentView.enterRoom()参照)。
    func start(
        schedule: PTTRoomManager.RoomSchedule?,
        state: PTTRoomManager.ScheduleState?,
        tokenServerURL: String,
        roomId: String,
        roomManager: PTTRoomManager,
        idTokenProvider: @escaping () async throws -> String
    ) {
        stop()
        self.schedule = schedule
        self.state = state
        guard state == .beforeStart else { return }

        timer = Timer.scheduledTimer(withTimeInterval: Self.pollIntervalSeconds, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.poll(
                    tokenServerURL: tokenServerURL,
                    roomId: roomId,
                    roomManager: roomManager,
                    idTokenProvider: idTokenProvider
                )
            }
        }
    }

    private func poll(
        tokenServerURL: String,
        roomId: String,
        roomManager: PTTRoomManager,
        idTokenProvider: @escaping () async throws -> String
    ) async {
        guard let idToken = try? await idTokenProvider() else { return }
        let fetched = await roomManager.fetchRoomName(tokenServerURL: tokenServerURL, idToken: idToken, roomId: roomId)
        schedule = fetched.schedule
        guard let newState = fetched.scheduleState, newState != .beforeStart else { return }
        state = newState
        timer?.invalidate()
        timer = nil
    }

    /// ルーム退出時に呼ぶ。
    func stop() {
        timer?.invalidate()
        timer = nil
        schedule = nil
        state = nil
    }
}
