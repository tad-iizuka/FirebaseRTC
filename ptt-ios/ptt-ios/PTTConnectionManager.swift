//
//  PTTConnectionManager.swift
//  PTTClient
//
//  [LiveKit移行]
//  以前はWebSocket直結 + AudioPipeline(AVAudioEngine + swift-opus)で
//  マイク取得・Opusエンコード/デコード・送受信をすべて自前実装していたが、
//  LiveKit Swift SDKの Room オブジェクトがこれらを全部代行するため、
//  このクラスは「トークン取得 → Room接続 → PTTのオン/オフ」の橋渡し役に縮小される。
//
//  送話中インジケーターは、以前は ptt_start/ptt_end の自前JSONメッセージだったが、
//  LiveKitの RoomDelegate が返す「トラックのmute/unmute」イベントをそのまま使う。
//

import Foundation
import Combine
import LiveKit

@MainActor
final class PTTConnectionManager: NSObject, ObservableObject {

    // MARK: - Published state (UIが監視する)

    @Published private(set) var status: ConnectionStatus = .disconnected
    @Published private(set) var talkers: Set<String> = []
    @Published private(set) var logLines: [String] = []
    @Published private(set) var isSending = false

    // MARK: - Private

    private var room: Room?
    private var tokenServerURL = ""
    private var livekitURL = ""
    private var roomName = ""
    private var identity = ""

    // MARK: - Public API

    func connect(tokenServerURL: String, livekitURL: String, room roomName: String, identity: String) {
        guard room == nil else {
            appendLog("すでに接続中/接続試行中です")
            return
        }

        self.tokenServerURL = tokenServerURL
        self.livekitURL = livekitURL
        self.roomName = roomName
        self.identity = identity
        status = .connecting

        Task {
            do {
                let token = try await fetchToken()
                appendLog("トークン取得成功")

                let newRoom = Room(delegate: self)
                room = newRoom

                try await newRoom.connect(url: livekitURL, token: token)

                // PTTのため、接続直後はマイクを無効化しておく
                // (トラックは作られるが送信されない = ボタンを押すまで無音)
                try await newRoom.localParticipant.setMicrophone(enabled: false)

                status = .connected(room: roomName)
                appendLog("ルーム接続完了: room=\(roomName) identity=\(identity)")
            } catch {
                appendLog("接続エラー: \(error.localizedDescription)")
                status = .error(error.localizedDescription)
                room = nil
            }
        }
    }

    func disconnect() {
        guard let room else { return }
        Task {
            await room.disconnect()
            self.room = nil
            talkers.removeAll()
            isSending = false
            status = .disconnected
            appendLog("切断しました")
        }
    }

    /// PTTボタンが押された
    func startTalking() {
        guard let room, case .connected = status, !isSending else { return }
        isSending = true
        Task {
            do {
                try await room.localParticipant.setMicrophone(enabled: true)
            } catch {
                appendLog("マイク有効化エラー: \(error.localizedDescription)")
                isSending = false
            }
        }
    }

    /// PTTボタンが離された
    func stopTalking() {
        guard let room, isSending else { return }
        isSending = false
        Task {
            do {
                try await room.localParticipant.setMicrophone(enabled: false)
            } catch {
                appendLog("マイク無効化エラー: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - トークン取得

    private struct TokenResponse: Decodable {
        let token: String
    }

    private func fetchToken() async throws -> String {
        guard var components = URLComponents(string: "\(tokenServerURL)/token") else {
            throw URLError(.badURL)
        }
        components.queryItems = [
            URLQueryItem(name: "room", value: roomName),
            URLQueryItem(name: "identity", value: identity),
        ]
        guard let url = components.url else { throw URLError(.badURL) }

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(TokenResponse.self, from: data).token
    }

    // MARK: - Log

    private func appendLog(_ line: String) {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        logLines.append("[\(timestamp)] \(line)")
        if logLines.count > 200 {
            logLines.removeFirst(logLines.count - 200)
        }
    }
}

// MARK: - RoomDelegate

extension PTTConnectionManager: RoomDelegate {

    nonisolated func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldConnectionState: ConnectionState) {
        Task { @MainActor in
            self.appendLog("接続状態: \(oldConnectionState) → \(connectionState)")
            if connectionState == .disconnected {
                self.talkers.removeAll()
                self.isSending = false
                self.room = nil
                if case .error = self.status {
                    // エラーによる切断は表示を残す
                } else {
                    self.status = .disconnected
                }
            }
        }
    }

    nonisolated func room(_ room: Room, didFailToConnectWithError error: LiveKitError?) {
        Task { @MainActor in
            self.appendLog("接続失敗: \(error?.localizedDescription ?? "不明なエラー")")
            self.status = .error(error?.localizedDescription ?? "接続失敗")
        }
    }

    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in
            self.appendLog("参加: \(participant.identity?.stringValue ?? "?")")
        }
    }

    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor in
            let id = participant.identity?.stringValue ?? "?"
            self.appendLog("退出: \(id)")
            self.talkers.remove(id)
        }
    }

    /// 送話中表示: 音声トラックのmute/unmuteをそのまま「送話中」リストの出し入れに使う。
    /// 以前の talker_start/talker_end に相当。
    nonisolated func room(_ room: Room, participant: Participant, trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool) {
        guard trackPublication.kind == .audio, let identity = participant.identity?.stringValue else { return }
        Task { @MainActor in
            if isMuted {
                self.talkers.remove(identity)
            } else {
                self.talkers.insert(identity)
            }
        }
    }
}
