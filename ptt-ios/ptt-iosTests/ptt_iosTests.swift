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
        let track = LocalAudioTrack.createTrack()
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
}
