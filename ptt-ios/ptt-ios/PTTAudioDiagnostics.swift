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
//
//  [再利用(2026-07-30)] Web→iOS初回送話が届かない不具合の診断のため、
//  PTTConnectionManager.swift の connect() から再びこの関数を呼ぶようにした
//  (再生エンジンの事前ウォームアップ前後でAVAudioSessionの状態を比較するため)。
//

import Foundation
import AVFAudio
import LiveKit

func logCurrentAudioSession(context: String) {
    let s = AVAudioSession.sharedInstance()
    print("🔊[\(context)] category=\(s.category.rawValue) mode=\(s.mode.rawValue) " +
          "options=\(s.categoryOptions.rawValue) isOtherAudioPlaying=\(s.isOtherAudioPlaying) " +
          "route.outputs=\(s.currentRoute.outputs.map { $0.portType.rawValue }) " +
          "route.inputs=\(s.currentRoute.inputs.map { $0.portType.rawValue })")
}

/// Monotonic milestones; no tokens, user IDs or audio are logged.
@MainActor
final class PTTStartTrace {
    let id = UUID().uuidString
    private let attempt: Int
    private let started = DispatchTime.now().uptimeNanoseconds
    private var previous: UInt64

    init(attempt: Int) {
        self.attempt = attempt
        previous = started
    }

    // Diagnostic state only; never used to control transmission or lock ownership.
    private(set) var microphoneEnableInFlight = false
    private(set) var releasedDuringEnable = false
    private var releasedAt: UInt64?

    func release(source: String) {
        if releasedAt == nil {
            releasedAt = DispatchTime.now().uptimeNanoseconds
            releasedDuringEnable = microphoneEnableInFlight
            mark("button_release source=\(source) during_microphone_enable=\(releasedDuringEnable)")
        } else {
            mark("stop_requested source=\(source)")
        }
    }

    func enableBegan() {
        microphoneEnableInFlight = true
        mark("microphone_enable_begin")
    }

    func enableEnded(success: Bool) {
        microphoneEnableInFlight = false
        mark(success ? "microphone_enable_complete" : "microphone_enable_failed")
    }

    func muteBegan(reason: String) -> UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        mark("microphone_mute_begin reason=\(reason)")
        return now
    }

    func muteEnded(began: UInt64, success: Bool, reason: String) {
        let now = DispatchTime.now().uptimeNanoseconds
        let releaseMS = releasedAt.map { String(format: "%.3f", Double(now - $0) / 1_000_000) } ?? "na"
        let muteMS = String(format: "%.3f", Double(now - began) / 1_000_000)
        mark("microphone_mute_\(success ? "complete" : "failed") reason=\(reason) mute_ms=\(muteMS) release_to_mute_ms=\(releaseMS) released_during_enable=\(releasedDuringEnable)")
    }

    func mark(_ stage: String) {
        let now = DispatchTime.now().uptimeNanoseconds
        print(String(format: "[PTTStart] id=%@ attempt=%d first=%@ stage=%@ total_ms=%.3f delta_ms=%.3f main=%@ uptime_ns=%llu",
                     id, attempt, attempt == 1 ? "true" : "false", stage,
                     Double(now - started) / 1_000_000,
                     Double(now - previous) / 1_000_000,
                     Thread.isMainThread ? "true" : "false", now))
        previous = now
    }
}

/// Synchronous ADM operations can block. Keep them on a serial worker queue.
enum PTTAudioWorker {
    nonisolated private static let queue = DispatchQueue(label: "ptt.audio.worker", qos: .userInitiated)

    nonisolated static func run(_ operation: @escaping @Sendable () throws -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    try operation()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

/// Only diagnostic SDK messages are elevated to debug; preserve ordinary info logs.
struct PTTPublishSDKLogger: LiveKit.Logger {
    // Public SDK API: retain one native log forwarder for this diagnostic session.
    nonisolated private let fallback = OSLogger(minLevel: .info, rtc: true, ffi: false)
    nonisolated func log(_ message: @autoclosure () -> CustomStringConvertible,
                        _ level: LogLevel, source: @autoclosure () -> String?,
                        file: StaticString, type: Any.Type, function: StaticString,
                        line: UInt, metaData: ScopedMetadataContainer) {
        let text = String(describing: message())
        let diagnostic = text.contains("Frame watcher") || text.contains("Waiting for audio frame")
            || text.contains("Completers for add track") || text.contains("resolving completer for cid:")
            || text.contains("Fast publish mode:") || text.contains("[publish] success")
            || text.contains("[publish] failed") || String(describing: type) == "Transport"
        if diagnostic {
            print("[PTTSDK] uptime_ns=\(DispatchTime.now().uptimeNanoseconds) level=\(level) type=\(type) function=\(function) line=\(line) message=\(text)")
        } else {
            fallback.log(text, level, source: source(), file: file,
                                         type: type, function: function, line: line, metaData: metaData)
        }
    }
}

@MainActor
func logPTTPublishState(stage: String, generation: String, room: Room,
                        currentRoom: Room?, track: LocalAudioTrack? = nil) {
    let publications = room.localParticipant.trackPublications.values.sorted { $0.sid.stringValue < $1.sid.stringValue }
        .map { pub in
            "sid=\(pub.sid.stringValue),source=\(pub.source),muted=\(pub.isMuted),track=\(pub.track.map { String(describing: ObjectIdentifier($0)) } ?? "nil")"
        }.joined(separator: ";")
    let trackState = track.map {
        "object=\(ObjectIdentifier($0)) sid=\($0.sid?.stringValue ?? "nil") muted=\($0.isMuted) state=\($0.trackState) publish_state=\($0.publishState)"
    } ?? "nil"
    print("[PTTPublish] generation=\(generation) stage=\(stage) uptime_ns=\(DispatchTime.now().uptimeNanoseconds) room_object=\(ObjectIdentifier(room)) current_room=\(currentRoom === room) connection=\(room.connectionState) room_sid=\(room.sid?.stringValue ?? "nil") participant_sid=\(room.localParticipant.sid?.stringValue ?? "nil") track={\(trackState)} publications=[\(publications)] cid=SDK_log_only sender=not_public transceiver=not_public task_cancelled=\(Task<Never, Never>.isCancelled)")
}
