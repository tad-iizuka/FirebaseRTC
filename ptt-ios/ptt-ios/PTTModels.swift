//
//  PTTModels.swift
//  PTTClient
//
//  サーバー(ptt-server/server.js)とやり取りするJSON制御メッセージの型定義。
//  バイナリ(Opus)フレームは別途扱う。
//

import Foundation

/// クライアント → サーバー へ送る制御メッセージ
enum OutgoingMessage {
    case join(room: String, clientId: String)
    case leave
    case pttStart
    case pttEnd

    var json: [String: Any] {
        switch self {
        case .join(let room, let clientId):
            return ["type": "join", "room": room, "clientId": clientId]
        case .leave:
            return ["type": "leave"]
        case .pttStart:
            return ["type": "ptt_start"]
        case .pttEnd:
            return ["type": "ptt_end"]
        }
    }

    func encoded() throws -> Data {
        try JSONSerialization.data(withJSONObject: json)
    }
}

/// audioFormat フィールド (joinedメッセージ内)
struct AudioFormat: Decodable {
    let sampleRate: Int
    let channels: Int
    let frameSize: Int
}

/// サーバー → クライアント の制御メッセージ。
/// server.js の broadcastJSON / sendJSON が送ってくる type を網羅する。
enum IncomingMessage {
    case joined(room: String, clientId: String, members: [String], audioFormat: AudioFormat)
    case memberJoined(clientId: String)
    case memberLeft(clientId: String)
    case talkerStart(clientId: String)
    case talkerEnd(clientId: String)
    case error(message: String)
    case unknown(raw: [String: Any])

    static func parse(_ data: Data) -> IncomingMessage? {
        guard
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = obj["type"] as? String
        else { return nil }

        switch type {
        case "joined":
            guard
                let room = obj["room"] as? String,
                let clientId = obj["clientId"] as? String,
                let members = obj["members"] as? [String],
                let afDict = obj["audioFormat"] as? [String: Any],
                let afData = try? JSONSerialization.data(withJSONObject: afDict),
                let audioFormat = try? JSONDecoder().decode(AudioFormat.self, from: afData)
            else { return .unknown(raw: obj) }
            return .joined(room: room, clientId: clientId, members: members, audioFormat: audioFormat)

        case "member_joined":
            guard let clientId = obj["clientId"] as? String else { return .unknown(raw: obj) }
            return .memberJoined(clientId: clientId)

        case "member_left":
            guard let clientId = obj["clientId"] as? String else { return .unknown(raw: obj) }
            return .memberLeft(clientId: clientId)

        case "talker_start":
            guard let clientId = obj["clientId"] as? String else { return .unknown(raw: obj) }
            return .talkerStart(clientId: clientId)

        case "talker_end":
            guard let clientId = obj["clientId"] as? String else { return .unknown(raw: obj) }
            return .talkerEnd(clientId: clientId)

        case "error":
            let message = obj["message"] as? String ?? "unknown error"
            return .error(message: message)

        default:
            return .unknown(raw: obj)
        }
    }
}

/// 接続状態（UI表示用）
enum ConnectionStatus: Equatable {
    case disconnected
    case connecting
    case connected(room: String)
    case error(String)
}
