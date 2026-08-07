//
//  ChatAvatarView.swift
//  ptt-ios
//
//  [チャットUI刷新・五十六訂のiOS移植]
//  Web版(ptt-client/src/components/ChatAvatar.vue + src/lib/avatarColor.ts)の移植。
//  表示の優先順位は3段階:
//    1. photoUrl があれば丸型の写真
//    2. role === "guest" ならベクターアイコン(顔写真を設定できないため、
//       頭文字よりも「ゲストである」ことが一目でわかる表現にする)
//    3. それ以外は頭文字 + uidから決定的に生成した色
//  プロフィール写真機能は本ファイル作成時点では未実装のため、実運用では
//  しばらく常に2/3のパスを通る。photoUrl側の分岐は将来の機能追加時に
//  このビューを変更せずに済むよう先に用意している。
//

import SwiftUI

struct ChatAvatarView: View {
    let uid: String
    let displayName: String
    let role: String?
    let photoUrl: String?
    var size: CGFloat = 34

    private var isGuest: Bool { role == "guest" }

    var body: some View {
        Group {
            if let photoUrl, let url = URL(string: photoUrl) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        Circle().fill(Color.pttPanel)
                    }
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
            } else if isGuest {
                // lucide-vue の `UserRound`(単純な丸型の人物アイコン)相当として
                // SF Symbolsの`person.fill`を使う。
                ZStack {
                    Circle().fill(Color.pttWarning.opacity(0.15))
                    Image(systemName: "person.fill")
                        .font(.system(size: size * 0.5))
                        .foregroundColor(.pttWarning)
                }
                .frame(width: size, height: size)
                .accessibilityLabel(String(localized: "ゲスト"))
            } else {
                let palette = ChatAvatarPalette.colors(forUid: uid)
                ZStack {
                    Circle().fill(palette.background)
                    Text(ChatAvatarPalette.initial(forDisplayName: displayName))
                        .font(.system(size: size * 0.4, weight: .medium, design: .monospaced))
                        .foregroundColor(palette.foreground)
                }
                .frame(width: size, height: size)
                .accessibilityLabel(displayName)
            }
        }
    }
}

/// [avatarColor.ts の移植] 生成アバター(頭文字)の背景色をuidから決定的に選ぶ。
/// 同一人物は常に同じ色になる(セッションをまたいでも安定)。JS版の
/// `(hash << 5) - hash + charCode; hash |= 0` と同じ32bit整数ハッシュを
/// Int32演算で再現し、Web版と同じ配色ロジックを保つ。
enum ChatAvatarPalette {
    private static let palette: [(background: Color, foreground: Color)] = [
        (Color.pttAccent.opacity(0.15), .pttAccent),
        (Color.pttLive.opacity(0.15), .pttLive),
        (Color.pttWarning.opacity(0.15), .pttWarning),
        (Color.pttDanger.opacity(0.15), .pttDanger),
        (Color.pttPanel, .pttText),
    ]

    static func colors(forUid uid: String) -> (background: Color, foreground: Color) {
        var hash: Int32 = 0
        for scalar in uid.unicodeScalars {
            hash = (hash &<< 5) &- hash &+ Int32(scalar.value)
        }
        let index = Int(abs(hash)) % palette.count
        return palette[index]
    }

    static func initial(forDisplayName displayName: String) -> String {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return "?" }
        return String(first).uppercased()
    }
}
