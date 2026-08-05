//
//  InviteLink.swift
//  ptt-ios
//
//  招待リンク(Universal Link)・QRコードの共通パース処理。
//  フォーマットはWeb版(ptt-client/src/lib/inviteLink.ts)・Android版(InviteLink.kt)と
//  一致させること: https://<ptt-clientのホスト>/r?room=<roomId>&code=<inviteCode>
//
//  受け取った側は入力欄への反映のみを行い、自動参加はしない(deeplink-qr-join-plan.md参照)。
//

import Foundation

struct PendingInvite: Equatable {
    let roomId: String
    let inviteCode: String
}

/// Universal Link起動時のURL、またはQRスキャナーが読み取った生文字列の両方に使う。
func parseInviteURL(_ url: URL) -> PendingInvite? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    let items = components.queryItems ?? []
    guard
        let roomId = items.first(where: { $0.name == "room" })?.value, !roomId.isEmpty,
        let inviteCode = items.first(where: { $0.name == "code" })?.value, !inviteCode.isEmpty
    else { return nil }
    return PendingInvite(roomId: roomId, inviteCode: inviteCode)
}

func parseInviteText(_ text: String) -> PendingInvite? {
    guard let url = URL(string: text) else { return nil }
    return parseInviteURL(url)
}
