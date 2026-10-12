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

#if DEBUG
/// No allocation or conversion: inspect at most 4096 scalar samples / 8 channels.
enum PTTPCMLevel {
    struct Result: Sendable {
        let sumSquares: Double
        let count: Int
        let peak: Double
        var rms: Double { count == 0 ? 0 : sqrt(sumSquares / Double(count)) }
    }

    nonisolated static func measure(_ buffer: AVAudioPCMBuffer) -> Result? {
        let channels = min(Int(buffer.format.channelCount), 8)
        guard channels > 0 else { return nil }
        let frames = min(Int(buffer.frameLength), 1024, 4096 / channels)
        guard frames > 0 else { return nil }
        var sum = 0.0
        var peak = 0.0
        switch buffer.format.commonFormat {
        case .pcmFormatFloat32:
            guard let data = buffer.floatChannelData else { return nil }
            for channel in 0..<channels {
                for frame in 0..<frames {
                    let raw = Double(data[channel][frame * buffer.stride])
                    guard raw.isFinite else { return nil }
                    let value = min(abs(raw), 1.0)
                    sum += value * value
                    peak = max(peak, value)
                }
            }
        case .pcmFormatInt16:
            guard let data = buffer.int16ChannelData else { return nil }
            for channel in 0..<channels {
                for frame in 0..<frames {
                    let value = abs(Double(data[channel][frame * buffer.stride])) / 32768.0
                    sum += value * value
                    peak = max(peak, value)
                }
            }
        default: return nil
        }
        return Result(sumSquares: sum, count: channels * frames, peak: peak)
    }
}

/// Shared capture-post PCM, not proof of hardware input or per-sender audio.
private final class PTTCaptureMeter: NSObject, AudioRenderer, @unchecked Sendable {
    private let lock = NSLock()
    private var callbacks: UInt64 = 0
    private var frames: UInt64 = 0
    private var samples: UInt64 = 0
    private var last: UInt64 = 0
    private var format: AVAudioCommonFormat = .otherFormat
    private var rate = 0.0
    private var channels: UInt32 = 0
    private var interleaved = false
    private var bytesPerFrame: UInt32 = 0
    private var rms: Double?
    private var peak: Double?
    private var windowEnergy = 0.0
    private var windowSamples = 0
    private var windowPeak = 0.0
    private var windowNonSilent = 0
    private var windowMeasured = 0
    private var windowUnsupported = 0

    func render(pcmBuffer: AVAudioPCMBuffer) {
        guard lock.try() else { return }
        defer { lock.unlock() }
        callbacks += 1
        frames += UInt64(pcmBuffer.frameLength)
        samples += UInt64(pcmBuffer.frameLength) * UInt64(pcmBuffer.format.channelCount)
        last = DispatchTime.now().uptimeNanoseconds
        format = pcmBuffer.format.commonFormat
        rate = pcmBuffer.format.sampleRate
        channels = pcmBuffer.format.channelCount
        interleaved = pcmBuffer.format.isInterleaved
        bytesPerFrame = pcmBuffer.format.streamDescription.pointee.mBytesPerFrame
        guard let level = PTTPCMLevel.measure(pcmBuffer) else {
            rms = nil; peak = nil; windowUnsupported += 1; return
        }
        rms = level.rms
        peak = level.peak
        windowEnergy += level.sumSquares
        windowSamples += level.count
        windowPeak = max(windowPeak, level.peak)
        windowMeasured += 1
        // Signal threshold only; not voice activity detection.
        if level.peak > 0.0001 { windowNonSilent += 1 }
    }

    func snapshot() -> String {
        lock.lock()
        defer { lock.unlock() }
        let name: String
        switch format {
        case .pcmFormatFloat32: name = "Float32"
        case .pcmFormatInt16: name = "Int16"
        default: name = "unsupported_\(format.rawValue)"
        }
        let windowRMS = windowSamples > 0 ? String(sqrt(windowEnergy / Double(windowSamples))) : "未計測"
        let value = "pcm_scope=shared_capture_post callbacks=\(callbacks) frames=\(frames) samples=\(samples) last_pcm_ns=\(last) sample_format=\(name) sample_rate=\(rate) channel_count=\(channels) samples_per_frame=\(channels) bytes_per_frame=\(bytesPerFrame) interleaved=\(interleaved) rms=\(rms.map(String.init(describing:)) ?? "未計測") peak=\(peak.map(String.init(describing:)) ?? "未計測") window_rms=\(windowRMS) window_peak=\(windowSamples > 0 ? String(windowPeak) : "未計測") window_measured_buffers=\(windowMeasured) window_non_silent_buffers=\(windowNonSilent) window_unsupported_buffers=\(windowUnsupported) signal_peak_threshold=0.0001 max_scalar_samples_per_buffer=4096 max_channels=8 callback_drop_on_contention=possible"
        windowEnergy = 0; windowSamples = 0; windowPeak = 0
        windowMeasured = 0; windowNonSilent = 0; windowUnsupported = 0
        return value
    }
}

@MainActor
final class PTTMediaObservation {
    let traceID: String
    private let room: Room
    private let meter = PTTCaptureMeter()
    private var task: Task<Void, Never>?
    private var attached = false
    private var statisticsTracks = Set<ObjectIdentifier>()

    init(traceID: String, room: Room) { self.traceID = traceID; self.room = room }

    func start(capture: Bool = true) {
        if capture {
            AudioManager.shared.add(localAudioRenderer: meter)
            attached = true
        }
        sample(stage: "enable_before")
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                // SDK stats timer runs separately; no await enters the PTT start/stop path.
                if !attached {
                    for pub in room.localParticipant.trackPublications.values {
                        if let track = pub.track, track.kind == .audio, statisticsTracks.insert(ObjectIdentifier(track)).inserted { await track.set(reportStatistics: true) }
                    }
                    for participant in room.remoteParticipants.values {
                        for pub in participant.trackPublications.values {
                            if let track = pub.track, track.kind == .audio, statisticsTracks.insert(ObjectIdentifier(track)).inserted { await track.set(reportStatistics: true) }
                        }
                    }
                }
                guard !Task.isCancelled else { return }
                sample(stage: "periodic")
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }

    func sample(stage: String) {
        let prefix = "[PTTMedia] trace=\(traceID) stage=\(stage) uptime_ns=\(DispatchTime.now().uptimeNanoseconds) room_sid=\(room.sid?.stringValue ?? "未計測") participant_sid=\(room.localParticipant.sid?.stringValue ?? "未計測") connection=\(room.connectionState)"
        print("\(prefix) engine_running=\(AudioManager.shared.isEngineRunning) engine_muted=\(AudioManager.shared.isMicrophoneMuted) adm_recording=未計測 session_active=未計測 \(PTTDebugEngineObserver.sessionFields()) \(attached ? meter.snapshot() : "pcm=未計測")")
        for pub in room.localParticipant.trackPublications.values where pub.kind == .audio {
            print("\(prefix) direction=out track_sid=\(pub.sid.stringValue) muted=\(pub.isMuted)")
            guard let stats = pub.track?.statistics, !stats.outboundRtpStream.isEmpty else {
                print("\(prefix) direction=out rtp=未計測 reason=no_cached_statistics"); continue
            }
            for stat in stats.outboundRtpStream where stat.kind == "audio" {
                print("\(prefix) direction=out track_sid=\(pub.sid.stringValue) stats_id=\(stat.id) stats_timestamp_us=\(stat.timestamp) ssrc=\(stat.ssrc.map(String.init) ?? "未計測") packetsSent=\(stat.packetsSent.map(String.init) ?? "未計測") bytesSent=\(stat.bytesSent.map(String.init) ?? "未計測")")
            }
        }
        if room.localParticipant.trackPublications.isEmpty { print("\(prefix) direction=out rtp=未計測 reason=no_publication") }
        for participant in room.remoteParticipants.values {
            for pub in participant.trackPublications.values where pub.kind == .audio {
                print("\(prefix) direction=in remote_participant_sid=\(participant.sid?.stringValue ?? "未計測") track_sid=\(pub.sid.stringValue) subscribed=\(pub.isSubscribed) muted=\(pub.isMuted)")
                guard let stats = pub.track?.statistics, !stats.inboundRtpStream.isEmpty else {
                    print("\(prefix) direction=in rtp=未計測 reason=no_cached_statistics"); continue
                }
                for stat in stats.inboundRtpStream where stat.kind == "audio" {
                    print("\(prefix) direction=in track_sid=\(pub.sid.stringValue) stats_id=\(stat.id) stats_timestamp_us=\(stat.timestamp) ssrc=\(stat.ssrc.map(String.init) ?? "未計測") packetsReceived=\(stat.packetsReceived.map(String.init) ?? "未計測") bytesReceived=\(stat.bytesReceived.map(String.init) ?? "未計測")")
                }
            }
        }
    }

    func finish() {
        task?.cancel()
        task = nil
        if attached { AudioManager.shared.remove(localAudioRenderer: meter); attached = false }
    }
}
#endif

#if DEBUG
/// Scalar configuration snapshot only; a valid format is not evidence of captured sound.
nonisolated struct PTTInputPathFormat: Sendable {
    let status: String
    let sampleRate: Double
    let channels: UInt32
    let commonFormat: UInt
    let interleaved: Bool

    init(_ format: AVAudioFormat) {
        sampleRate = format.sampleRate
        channels = format.channelCount
        commonFormat = format.commonFormat.rawValue
        interleaved = format.isInterleaved
        status = sampleRate.isFinite && sampleRate > 0 && channels > 0 ? "valid_configuration" : "unavailable_zero_or_invalid_format"
    }
    var fields: String {
        "status=\(status),rate=\(sampleRate),channels=\(channels),common_format=\(commonFormat),interleaved=\(interleaved)"
    }
}

/// Fixed-capacity, best-effort handoff. No wait on native callbacks, no retained nodes.
nonisolated final class PTTInputPathBuffer: @unchecked Sendable {
    struct Event: Sendable {
        let name: String
        let time: UInt64
        var engineID: ObjectIdentifier? = nil
        var engineGeneration: UInt64? = nil
        var playout: Bool? = nil
        var recording: Bool? = nil
        var result: Int? = nil
        var sourceID: ObjectIdentifier? = nil
        var destinationID: ObjectIdentifier? = nil
        var inputFormat: PTTInputPathFormat? = nil
        var outputFormat: PTTInputPathFormat? = nil
        var connectionStatus: String? = nil
        var notificationValue: UInt? = nil
        var notificationOptions: UInt? = nil
    }
    private let lock = NSLock()
    private var storage: [Event?]
    private var head = 0
    private var count = 0
    private var overflowDrops = 0
    private var generation: UInt64 = 0
    private var engines: [ObjectIdentifier: UInt64] = [:]
    init(capacity: Int = 64) { storage = Array(repeating: nil, count: max(1, capacity)) }

    func put(_ original: Event) {
        guard lock.try() else { return }
        defer { lock.unlock() }
        var event = original
        if let id = event.engineID {
            if event.name == "did_create" {
                generation &+= 1
                if engines.count >= 16 { engines.removeAll(keepingCapacity: true) }
                engines[id] = generation
            }
            event.engineGeneration = engines[id]
            if event.name == "will_release" { engines.removeValue(forKey: id) }
        }
        guard count < storage.count else { overflowDrops += 1; return }
        storage[(head + count) % storage.count] = event
        count += 1
    }

    func take(limit: Int = 8) -> (events: [Event], overflowDrops: Int)? {
        guard lock.try() else { return nil }
        defer { lock.unlock() }
        var events: [Event] = []
        for _ in 0..<min(max(0, limit), count) {
            if let event = storage[head] { events.append(event) }
            storage[head] = nil
            head = (head + 1) % storage.count
            count -= 1
        }
        let drops = overflowDrops
        overflowDrops = 0
        return (events, drops)
    }
}

/// Installs ahead of the existing SDK session/mixer observers. All reads are lifecycle-only.
final class PTTDebugEngineObserver: AudioEngineObserver, @unchecked Sendable {
    var next: (any AudioEngineObserver)?
    let buffer = PTTInputPathBuffer()
    @MainActor static let shared = PTTDebugEngineObserver()
    @MainActor private static var installed = false
    @MainActor private static var contexts: [(time: UInt64, generation: String, trace: String)] = []
    @MainActor private static var notificationTokens: [NSObjectProtocol] = []
    @MainActor private static var pump: Task<Void, Never>?

    @MainActor static func install() {
        guard !installed else { return }
        installed = true
        let manager = AudioManager.shared
        manager.set(engineObservers: [shared, manager.audioSession, manager.mixer])
        let buffer = shared.buffer
        let center = NotificationCenter.default
        for (name, label, key) in [
            (AVAudioSession.interruptionNotification, "session_interruption", AVAudioSessionInterruptionTypeKey),
            (AVAudioSession.routeChangeNotification, "session_route_change", AVAudioSessionRouteChangeReasonKey),
            (AVAudioSession.mediaServicesWereResetNotification, "session_media_services_reset", "")
        ] {
            notificationTokens.append(center.addObserver(forName: name, object: nil, queue: nil) { notification in
                // No session/engine getters on the notification delivery thread.
                var event = PTTInputPathBuffer.Event(name: label, time: DispatchTime.now().uptimeNanoseconds)
                event.notificationValue = (notification.userInfo?[key] as? NSNumber)?.uintValue
                event.notificationOptions = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue
                buffer.put(event)
            })
        }
        if #available(iOS 17.0, *) {
            notificationTokens.append(center.addObserver(forName: AVAudioApplication.inputMuteStateChangeNotification, object: nil, queue: nil) { notification in
                var event = PTTInputPathBuffer.Event(name: "application_input_mute_change", time: DispatchTime.now().uptimeNanoseconds)
                event.notificationValue = (notification.userInfo?[AVAudioApplication.muteStateKey] as? NSNumber)?.uintValue
                buffer.put(event)
            })
        }
        pump = Task { @MainActor in
            while !Task.isCancelled {
                shared.drain()
                do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            }
        }
    }

    @MainActor static func context(generation: String, trace: String = "none") {
        contexts.append((DispatchTime.now().uptimeNanoseconds, generation, trace))
        if contexts.count > 128 { contexts.removeFirst() }
    }

    @MainActor static func sessionFields() -> String {
        let session = AVAudioSession.sharedInstance()
        let appMute: String
        if #available(iOS 17.0, *) { appMute = String(AVAudioApplication.shared.isInputMuted) }
        else { appMute = "未計測_os_before_17" }
        return "session_snapshot_uptime_ns=\(DispatchTime.now().uptimeNanoseconds) category=\(session.category.rawValue) mode=\(session.mode.rawValue) inputs=\(session.currentRoute.inputs.map { $0.portType.rawValue }) outputs=\(session.currentRoute.outputs.map { $0.portType.rawValue }) input_available=\(session.isInputAvailable) application_input_muted=\(appMute) application_mute_scope=per_app_not_vp_not_hardware"
    }

    @MainActor private func drain() {
        guard let batch = buffer.take() else { return }
        for event in batch.events {
            let context = Self.contexts.last { $0.time <= event.time }
            let fields = Self.sessionFields()
            let snapshotTime = DispatchTime.now().uptimeNanoseconds
            print("[PTTEngine] event=\(event.name) event_uptime_ns=\(event.time) engine_id=\(event.engineID.map(String.init(describing:)) ?? "未計測") engine_generation=\(event.engineGeneration.map(String.init) ?? "未計測") input_enabled_argument=\(event.recording.map(String.init) ?? "未計測") playout_enabled_argument=\(event.playout.map(String.init) ?? "未計測") observer_result=\(event.result.map(String.init) ?? "未計測") context_generation=\(context?.generation ?? "未計測") context_trace=\(context?.trace ?? "未計測") ownership=未計測 snapshot_uptime_ns=\(snapshotTime) \(fields) source_id=\(event.sourceID.map(String.init(describing:)) ?? "未計測") destination_id=\(event.destinationID.map(String.init(describing:)) ?? "未計測") connection_status=\(event.connectionStatus ?? "not_applicable") input_format={\(event.inputFormat?.fields ?? "未計測")} output_format={\(event.outputFormat?.fields ?? "未計測")} notification_value=\(event.notificationValue.map(String.init) ?? "未計測") interruption_options=\(event.notificationOptions.map(String.init) ?? "未計測") voice_processing_actual_mute=未計測 adm_recording=未計測 capture_proven=false callback_drop_on_contention=possible")
        }
        if batch.overflowDrops > 0 { print("[PTTEngine] event=observation_overflow dropped=\(batch.overflowDrops) capture_proven=false") }
    }

    private func record(_ name: String, engine: AVAudioEngine, playout: Bool? = nil, recording: Bool? = nil, result: Int, at time: UInt64) {
        var event = PTTInputPathBuffer.Event(name: name, time: time)
        event.engineID = ObjectIdentifier(engine)
        event.playout = playout
        event.recording = recording
        event.result = result
        buffer.put(event)
    }
    func engineDidCreate(_ engine: AVAudioEngine) -> Int {
        let time = DispatchTime.now().uptimeNanoseconds
        let result = next?.engineDidCreate(engine) ?? 0
        record("did_create", engine: engine, result: result, at: time)
        return result
    }
    func engineWillEnable(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        let time = DispatchTime.now().uptimeNanoseconds
        let result = next?.engineWillEnable(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        record("will_enable", engine: engine, playout: isPlayoutEnabled, recording: isRecordingEnabled, result: result, at: time)
        return result
    }
    func engineWillStart(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        let time = DispatchTime.now().uptimeNanoseconds
        let result = next?.engineWillStart(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        record("will_start", engine: engine, playout: isPlayoutEnabled, recording: isRecordingEnabled, result: result, at: time)
        return result
    }
    func engineDidStop(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        let time = DispatchTime.now().uptimeNanoseconds
        let result = next?.engineDidStop(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        record("did_stop", engine: engine, playout: isPlayoutEnabled, recording: isRecordingEnabled, result: result, at: time)
        return result
    }
    func engineDidDisable(_ engine: AVAudioEngine, isPlayoutEnabled: Bool, isRecordingEnabled: Bool) -> Int {
        let time = DispatchTime.now().uptimeNanoseconds
        let result = next?.engineDidDisable(engine, isPlayoutEnabled: isPlayoutEnabled, isRecordingEnabled: isRecordingEnabled) ?? 0
        record("did_disable", engine: engine, playout: isPlayoutEnabled, recording: isRecordingEnabled, result: result, at: time)
        return result
    }
    func engineWillRelease(_ engine: AVAudioEngine) -> Int {
        let time = DispatchTime.now().uptimeNanoseconds
        let result = next?.engineWillRelease(engine) ?? 0
        record("will_release", engine: engine, result: result, at: time)
        return result
    }
    func engineWillConnectInput(_ engine: AVAudioEngine, src: AVAudioNode?, dst: AVAudioNode, format: AVAudioFormat, context: [AnyHashable: Any]) -> Int {
        // Called on the SDK's worker thread during input setup, not in a render callback.
        // Read only the supplied existing input node AFTER forwarding SDK graph configuration.
        let result = next?.engineWillConnectInput(engine, src: src, dst: dst, format: format, context: context) ?? 0
        var event = PTTInputPathBuffer.Event(name: "will_connect_input", time: DispatchTime.now().uptimeNanoseconds)
        event.engineID = ObjectIdentifier(engine)
        event.sourceID = src.map(ObjectIdentifier.init)
        event.destinationID = ObjectIdentifier(dst)
        event.result = result
        if result != 0 { event.connectionStatus = "skipped_observer_error" }
        else if src == nil { event.connectionStatus = "no_source_manual_or_unavailable" }
        else if let input = src as? AVAudioInputNode {
            // AVAudioNode bus-format getters are read-only; bounds are checked before access.
            // No engine.inputNode access, VP getter, AudioUnit getter, or graph mutation here.
            if input.numberOfInputs > 0 { event.inputFormat = PTTInputPathFormat(input.inputFormat(forBus: 0)) }
            if input.numberOfOutputs > 0 { event.outputFormat = PTTInputPathFormat(input.outputFormat(forBus: 0)) }
            event.connectionStatus = event.inputFormat != nil && event.outputFormat != nil ? "provided_input_node_configuration" : "unavailable_bus"
        } else { event.connectionStatus = "unsupported_source_node_type" }
        buffer.put(event)
        return result
    }
    // Output graph callbacks retain the SDK's default forwarding.
}
#endif
