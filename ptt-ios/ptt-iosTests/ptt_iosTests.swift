import Foundation
import Testing
import LiveKit
@testable import ptt_ios

struct ptt_iosTests {
    @Test @MainActor func audioWarmupDoesNotBlockMainThread() async throws {
        try await PTTAudioWorker.run {
            #expect(!Thread.isMainThread)
        }
    }

    @Test @MainActor func keepAliveTrackIsMutedBeforePublication() async throws {
        let track = await LocalAudioTrack.createTrack()
        try await track.mute()
        #expect(track.isMuted)

    }

    @Test @MainActor func disconnectedPressCannotStartTransmission() {
        let connection = PTTConnectionManager()
        connection.startTalking()
        connection.startTalking()
        #expect(!connection.isAcquiringTalk)
        #expect(!connection.isSending)
    }
    @Test @MainActor func releaseDiagnosticKeepsEnableOverlapAfterCompletion() {
        let trace = PTTStartTrace(attempt: 1)
        trace.enableBegan()
        trace.release(source: "button")
        trace.enableEnded(success: true)
        #expect(!trace.microphoneEnableInFlight)
        #expect(trace.releasedDuringEnable)
        trace.release(source: "button")
        #expect(trace.releasedDuringEnable)
    }

    @Test @MainActor func releaseBeforeEnableIsNotReportedAsOverlap() {
        let trace = PTTStartTrace(attempt: 2)
        trace.release(source: "button")
        #expect(!trace.releasedDuringEnable)
        trace.enableBegan()
        trace.enableEnded(success: false)
        #expect(!trace.microphoneEnableInFlight)
        #expect(!trace.releasedDuringEnable)
    }

}

/// Gates deliberately ignore cancellation, as an SDK await may finish after exit.
@MainActor
private final class ConnectionGate {
    private var completion: CheckedContinuation<Void, Error>?
    private var arrival: CheckedContinuation<Void, Never>?
    private var entered = false
    func suspend() async throws {
        try await withCheckedThrowingContinuation { continuation in
            completion = continuation
            entered = true
            arrival?.resume()
            arrival = nil
        }
    }
    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { arrival = $0 }
    }
    func finish(_ error: Error? = nil) {
        if let error { completion?.resume(throwing: error) }
        else { completion?.resume() }
        completion = nil
    }
}

@MainActor
private final class ConnectionProbe {
    static var errorPrefix: String {
        String(format: NSLocalizedString("接続エラー: %@", comment: "Connection error log"), "__reason__")
            .components(separatedBy: "__reason__")[0]
    }
    var connected: [Room] = []
    var disconnected: [Room] = []
    var stoppedWarmups = 0
    var publishedMuted = true
    var muteBeforeRelease: [String] = []
    func operations() -> PTTConnectionManager.ConnectionOperations {
        var operations = PTTConnectionManager.ConnectionOperations()
        operations.token = { "test-token" }
        operations.connect = { room, _, _ in self.connected.append(room) }
        operations.permission = { true }
        operations.warmup = {}
        operations.stopWarmup = { self.stoppedWarmups += 1 }
        operations.publish = { _, track in
            self.publishedMuted = track.isMuted
            return track.isMuted
        }
        operations.disconnect = { self.disconnected.append($0) }
        operations.mute = { _ in self.muteBeforeRelease.append("mute") }
        operations.releaseTalk = { self.muteBeforeRelease.append("release") }
        return operations
    }
    func enter(_ manager: PTTConnectionManager) {
        manager.connect(tokenServerURL: "https://unused.invalid", livekitURL: "wss://unused.invalid", room: "test-room", idTokenProvider: { "unused" })
    }
}

struct ConnectionGenerationTests {
    @Test @MainActor func exitDuringTokenIgnoresLateSuccessAndAllowsReentry() async {
        let gate = ConnectionGate(), probe = ConnectionProbe()
        var operations = probe.operations()
        var tokenCalls = 0
        operations.token = {
            tokenCalls += 1
            if tokenCalls == 1 { try await gate.suspend() }
            return "test-token"
        }
        let manager = PTTConnectionManager(connectionOperations: operations)
        probe.enter(manager)
        await gate.waitUntilEntered()
        manager.disconnect()
        #expect(manager.status == .disconnected)
        #expect(manager.ownedConnectionRoom == nil)
        probe.enter(manager)
        gate.finish()
        await manager.waitForConnectionPreparation()
        #expect(manager.status == .connected(room: "test-room"))
        #expect(probe.connected.count == 1) // No Room created from the old token result.
        #expect(probe.publishedMuted)
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }

    @Test @MainActor func intentionalTokenCancellationDoesNotDisplayError() async {
        let gate = ConnectionGate(), probe = ConnectionProbe()
        var operations = probe.operations()
        operations.token = { try await gate.suspend(); return "unused" }
        let manager = PTTConnectionManager(connectionOperations: operations)
        probe.enter(manager)
        await gate.waitUntilEntered()
        manager.disconnect()
        gate.finish(CancellationError())
        await manager.waitForConnectionCleanup()
        #expect(manager.status == .disconnected)
        #expect(!manager.logLines.contains { $0.contains(ConnectionProbe.errorPrefix) })
        #expect(probe.connected.isEmpty)
    }

    @Test @MainActor func exitDuringRoomConnectDoesNotReportCancelled() async {
        let gate = ConnectionGate(), probe = ConnectionProbe()
        var operations = probe.operations()
        operations.connect = { room, _, _ in
            probe.connected.append(room)
            try await gate.suspend()
        }
        let manager = PTTConnectionManager(connectionOperations: operations)
        probe.enter(manager)
        await gate.waitUntilEntered()
        let oldRoom = manager.ownedConnectionRoom
        manager.disconnect()
        gate.finish(CancellationError())
        await manager.waitForConnectionCleanup()
        #expect(manager.status == .disconnected)
        #expect(!manager.logLines.contains { $0.contains(ConnectionProbe.errorPrefix) })
        #expect(probe.disconnected.allSatisfy { $0 === oldRoom })
        #expect(probe.muteBeforeRelease == ["mute", "release"])
    }

    @Test @MainActor func exitDuringWarmupDrainsOldEngineBeforeNewRoom() async {
        let gate = ConnectionGate(), probe = ConnectionProbe()
        var operations = probe.operations()
        var warmups = 0
        operations.warmup = {
            warmups += 1
            if warmups == 1 { try await gate.suspend() }
            else { #expect(probe.stoppedWarmups == 1) }
        }
        let manager = PTTConnectionManager(connectionOperations: operations)
        probe.enter(manager)
        await gate.waitUntilEntered()
        let oldRoom = manager.ownedConnectionRoom
        manager.disconnect()
        probe.enter(manager)
        #expect(probe.connected.count == 1)
        gate.finish()
        await manager.waitForConnectionPreparation()
        let newRoom = manager.ownedConnectionRoom
        #expect(newRoom !== oldRoom)
        #expect(manager.status == .connected(room: "test-room"))
        #expect(probe.stoppedWarmups == 1)
        #expect(probe.disconnected.allSatisfy { $0 === oldRoom })
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }

    @Test(arguments: [false, true]) @MainActor
    func exitDuringPublishIgnoresOldSuccessOrFailure(fail: Bool) async {
        let gate = ConnectionGate(), probe = ConnectionProbe()
        var operations = probe.operations()
        var publishes = 0
        operations.publish = { _, track in
            #expect(track.isMuted)
            publishes += 1
            if publishes == 1 { try await gate.suspend(); return false }
            return true
        }
        let manager = PTTConnectionManager(connectionOperations: operations)
        probe.enter(manager)
        await gate.waitUntilEntered()
        let oldRoom = manager.ownedConnectionRoom
        manager.disconnect()
        probe.enter(manager)
        if fail { gate.finish(URLError(.timedOut)) } else { gate.finish() }
        await manager.waitForConnectionPreparation()
        #expect(manager.status == .connected(room: "test-room"))
        #expect(manager.ownedConnectionRoom !== oldRoom)
        #expect(probe.disconnected.allSatisfy { $0 === oldRoom })
        #expect(!manager.logLines.contains { $0.contains("muted_publish_failed") || $0.contains("muted_publish_complete muted=false") || $0.contains(ConnectionProbe.errorPrefix) })
        // Late old delegate events must not mutate the new generation either.
        if let oldRoom {
            manager.room(oldRoom, didFailToConnectWithError: nil)
            manager.room(oldRoom, didUpdateMetadata: "{\"currentTalker\":\"old-user\"}")
            await Task.yield()
            #expect(manager.status == .connected(room: "test-room"))
            #expect(manager.currentTalkerUid == nil)
        }
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }

    @Test @MainActor func newRoomWaitsForOldCleanupAndIgnoresOldDisconnectDelegate() async {
        let gate = ConnectionGate(), probe = ConnectionProbe()
        var operations = probe.operations()
        var stops = 0
        operations.stopWarmup = {
            stops += 1
            if stops == 1 { try? await gate.suspend() }
        }
        let manager = PTTConnectionManager(connectionOperations: operations)
        probe.enter(manager)
        await manager.waitForConnectionPreparation()
        let oldRoom = manager.ownedConnectionRoom
        manager.disconnect()
        await gate.waitUntilEntered()
        probe.enter(manager)
        #expect(manager.status == .connecting)
        #expect(probe.connected.count == 1)
        gate.finish()
        await manager.waitForConnectionPreparation()
        #expect(probe.connected.count == 2)
        #expect(manager.ownedConnectionRoom !== oldRoom)
        #expect(probe.disconnected.allSatisfy { $0 === oldRoom })
        if let oldRoom {
            manager.room(oldRoom, didUpdateConnectionState: .disconnected, from: .connected)
            await Task.yield()
        }
        #expect(manager.status == .connected(room: "test-room"))
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }

    @Test @MainActor func currentFailureStillDisplaysError() async {
        let probe = ConnectionProbe()
        var operations = probe.operations()
        operations.token = { throw URLError(.badServerResponse) }
        let manager = PTTConnectionManager(connectionOperations: operations)
        probe.enter(manager)
        await manager.waitForConnectionPreparation()
        await manager.waitForConnectionCleanup()
        if case .error = manager.status {} else { Issue.record("Current generation failure was hidden") }
        #expect(manager.logLines.contains { $0.contains(ConnectionProbe.errorPrefix) })
    }
}

@MainActor
private final class TalkRaceProbe {
    var events: [String] = []
    var enabled = false
    var locked = false
    var failStop = false
    var failMute = false
    var enableGate: ConnectionGate?
    var acquireGate: ConnectionGate?
    var muteGate: ConnectionGate?
    func makeManager() -> PTTConnectionManager {
        var connection = ConnectionProbe().operations()
        connection.mute = { _ in
            if let gate = self.muteGate { self.muteGate = nil; try await gate.suspend() }
            if self.failMute { throw URLError(.cannotConnectToHost) }
            self.enabled = false
            self.events.append("mute")
        }
        connection.disconnect = { _ in self.enabled = false; self.events.append("disconnect") }
        connection.releaseTalk = { self.release() }
        var talk = PTTConnectionManager.TalkOperations()
        talk.request = { action in
            if action == "start" {
                if let gate = self.acquireGate { self.acquireGate = nil; try await gate.suspend() }
                #expect(!self.locked)
                self.locked = true
                self.events.append("acquire")
            } else if action == "stop" {
                if self.failStop { throw URLError(.notConnectedToInternet) }
                self.release()
            }
        }
        talk.enable = { _ in
            #expect(self.locked) // Never enable before the grant.
            self.events.append("enable.begin")
            if let gate = self.enableGate { self.enableGate = nil; try await gate.suspend() }
            self.enabled = true
            self.events.append("enable.complete")
        }
        return PTTConnectionManager(connectionOperations: connection, talkOperations: talk)
    }
    func release() {
        #expect(!enabled) // Every release must follow mute or disconnect.
        locked = false
        events.append("release")
    }
    func enter(_ manager: PTTConnectionManager) async {
        ConnectionProbe().enter(manager)
        await manager.waitForConnectionPreparation()
    }
}

struct TalkReleaseRaceTests {
    @Test @MainActor func releaseBeforeEnableSkipsEnable() async {
        let probe = TalkRaceProbe(), gate = ConnectionGate()
        probe.acquireGate = gate
        let manager = probe.makeManager()
        await probe.enter(manager)
        manager.startTalking()
        await gate.waitUntilEntered()
        manager.stopTalking(source: "button")
        gate.finish()
        await manager.waitForTalkOperations()
        #expect(!probe.events.contains("enable.begin"))
        #expect(!probe.enabled && !probe.locked && !manager.isSending)
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }

    @Test @MainActor func releaseDuringEnableRemutesBeforeReleasingLock() async {
        let probe = TalkRaceProbe(), gate = ConnectionGate()
        probe.enableGate = gate
        let manager = probe.makeManager()
        await probe.enter(manager)
        manager.startTalking()
        await gate.waitUntilEntered()
        manager.stopTalking(source: "button")
        #expect(probe.locked)
        gate.finish() // SDK finishes late even though the button is no longer held.
        await manager.waitForTalkOperations()
        #expect(probe.events == ["acquire", "enable.begin", "enable.complete", "mute", "mute", "release"])
        #expect(!probe.enabled && !probe.locked && !manager.isSending)
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }

    @Test @MainActor func releaseImmediatelyAfterEnableMutesBeforeReleasingLock() async {
        let probe = TalkRaceProbe()
        let manager = probe.makeManager()
        await probe.enter(manager)
        manager.startTalking()
        await manager.waitForTalkOperations()
        #expect(manager.isSending && probe.enabled)
        manager.stopTalking(source: "button")
        await manager.waitForTalkOperations()
        #expect(probe.events == ["acquire", "enable.begin", "enable.complete", "mute", "release"])
        #expect(!probe.enabled && !probe.locked && !manager.isSending)
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }

    @Test @MainActor func nextPressWaitsForPreviousMuteAndRelease() async {
        let probe = TalkRaceProbe(), gate = ConnectionGate()
        let manager = probe.makeManager()
        await probe.enter(manager)
        manager.startTalking()
        await manager.waitForTalkOperations()
        probe.muteGate = gate
        manager.stopTalking(source: "button")
        await gate.waitUntilEntered()
        manager.startTalking()
        #expect(probe.events.filter { $0 == "acquire" }.count == 1)
        gate.finish()
        await manager.waitForTalkOperations()
        #expect(!probe.enabled && !probe.locked)
        manager.startTalking() // A deliberate press after the stop completes is accepted.
        await manager.waitForTalkOperations()
        #expect(probe.events == ["acquire", "enable.begin", "enable.complete", "mute", "release", "acquire", "enable.begin", "enable.complete"])
        manager.stopTalking(source: "button")
        await manager.waitForTalkOperations()
        #expect(!probe.enabled && !probe.locked)
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }

    @Test @MainActor func exitDuringEnableDrainsLateCompletionBeforeReentry() async {
        let probe = TalkRaceProbe(), gate = ConnectionGate()
        probe.enableGate = gate
        let manager = probe.makeManager()
        await probe.enter(manager)
        let oldRoom = manager.ownedConnectionRoom
        manager.startTalking()
        await gate.waitUntilEntered()
        manager.disconnect()
        ConnectionProbe().enter(manager)
        #expect(!manager.isSending)
        gate.finish()
        await manager.waitForConnectionPreparation()
        #expect(manager.ownedConnectionRoom !== oldRoom)
        #expect(manager.status == .connected(room: "test-room"))
        #expect(!probe.enabled && !probe.locked && !manager.isSending)
        #expect(probe.events.prefix(6) == ["acquire", "enable.begin", "enable.complete", "mute", "mute", "release"])
        manager.disconnect()
        await manager.waitForConnectionCleanup()
    }
}

struct ScreenPressSafetyTests {
    @Test(arguments: ["gesture_end_or_cancel", "scene_inactive"])
    @MainActor func normalOrInactiveStopsOnce(source: String) async throws {
        let p = TalkRaceProbe(), m = p.makeManager()
        await p.enter(m)
        let press = try #require(m.startScreenTalking())
        await m.waitForTalkOperations()
        m.stopScreenTalking(press, source: source)
        m.stopScreenTalking(press, source: "gesture_end_or_cancel")
        await m.waitForTalkOperations()
        #expect(p.events.filter { $0 == "release" }.count == 1)
        #expect(!p.enabled && !p.locked && !m.isStoppingTalk)
        #expect(!m.isSending) // Returning active does not invoke a new start.
        let newer = try #require(m.startScreenTalking())
        await m.waitForTalkOperations()
        m.stopScreenTalking(press, source: "late_onEnded")
        #expect(m.isSending && p.enabled)
        m.stopScreenTalking(newer, source: "gesture_end_or_cancel")
        await m.waitForTalkOperations()
        m.disconnect(); await m.waitForConnectionCleanup()
    }

    @Test(arguments: [false, true]) @MainActor
    func inactiveDuringAcquisitionOrEnable(enable: Bool) async throws {
        let p = TalkRaceProbe(), gate = ConnectionGate()
        if enable { p.enableGate = gate } else { p.acquireGate = gate }
        let m = p.makeManager()
        await p.enter(m)
        let press = try #require(m.startScreenTalking())
        await gate.waitUntilEntered()
        m.stopScreenTalking(press, source: "scene_inactive")
        #expect(m.isStoppingTalk)
        #expect(m.startScreenTalking() == nil)
        gate.finish()
        await m.waitForTalkOperations()
        #expect(!p.enabled && !p.locked && !m.isSending)
        #expect(p.events.filter { $0 == "release" }.count == 1)
        if !enable { #expect(!p.events.contains("enable.begin")) }
        m.disconnect(); await m.waitForConnectionCleanup()
    }

    @Test @MainActor func stoppingRejectsScreenPressAndDuplicateRelease() async throws {
        let p = TalkRaceProbe(), gate = ConnectionGate(), m = p.makeManager()
        await p.enter(m)
        let press = try #require(m.startScreenTalking())
        await m.waitForTalkOperations()
        p.muteGate = gate
        m.stopScreenTalking(press, source: "scene_inactive")
        await gate.waitUntilEntered()
        #expect(m.startScreenTalking() == nil)
        m.stopScreenTalking(press, source: "late_onEnded")
        gate.finish()
        await m.waitForTalkOperations()
        #expect(p.events.filter { $0 == "release" }.count == 1)
        m.disconnect(); await m.waitForConnectionCleanup()
    }

    @Test @MainActor func oldScreenReleaseCannotStopNewGeneration() async throws {
        let p = TalkRaceProbe(), m = p.makeManager()
        await p.enter(m)
        let old = try #require(m.startScreenTalking())
        await m.waitForTalkOperations()
        m.disconnect(); await m.waitForConnectionCleanup()
        await p.enter(m)
        let fresh = try #require(m.startScreenTalking())
        await m.waitForTalkOperations()
        #expect(old.generation != fresh.generation)
        m.stopScreenTalking(old, source: "late_onEnded")
        #expect(m.isSending && p.enabled)
        m.stopScreenTalking(fresh, source: "gesture_end_or_cancel")
        await m.waitForTalkOperations()
        m.disconnect(); await m.waitForConnectionCleanup()
    }

    @Test @MainActor func stopHttpFailureRemainsBlockedAndVisible() async throws {
        let p = TalkRaceProbe(), m = p.makeManager()
        await p.enter(m)
        let press = try #require(m.startScreenTalking())
        await m.waitForTalkOperations()
        p.failStop = true
        m.stopScreenTalking(press, source: "scene_inactive")
        await m.waitForTalkOperations()
        #expect(!p.enabled && p.locked)
        #expect(m.isStoppingTalk && m.talkStopError != nil)
        #expect(m.startScreenTalking() == nil)
        m.disconnect(); await m.waitForConnectionCleanup()
    }

    @Test @MainActor func muteFailureDisconnectsBeforeFloorRelease() async throws {
        let p = TalkRaceProbe(), m = p.makeManager()
        await p.enter(m)
        let press = try #require(m.startScreenTalking())
        await m.waitForTalkOperations()
        p.failMute = true
        m.stopScreenTalking(press, source: "scene_inactive")
        await m.waitForTalkOperations()
        #expect(p.events.suffix(2) == ["disconnect", "release"])
        #expect(!p.enabled && !p.locked)
        m.disconnect(); await m.waitForConnectionCleanup()
    }

    @Test @MainActor func sceneWithoutScreenPressDoesNotStopRemoteTalk() async {
        let p = TalkRaceProbe(), m = p.makeManager()
        await p.enter(m)
        m.startTalking()
        await m.waitForTalkOperations()
        #expect(m.startScreenTalking() == nil)
        #expect(m.isSending && p.enabled)
        // The view calls stopScreenTalking only with its own non-nil handle.
        m.stopTalking()
        await m.waitForTalkOperations()
        m.disconnect(); await m.waitForConnectionCleanup()
    }
}
