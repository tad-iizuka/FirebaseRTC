//
//  LoginStatusIcon.swift
//  ptt-ios
//
//  [ログイン状態のアイコン化] Web版 ptt-client/src/components/LoginStatusIcon.vue の移植。
//  以前はヘッダーに「表示名テキスト + サインアウトテキストボタン」を常時表示していたが、
//  Web版に合わせて丸いアイコン1個(タップでメニュー)に統一する。
//  Googleサインイン等でphotoURLを持つ場合はその画像を表示し、ゲスト(匿名認証)・
//  未サインインなど写真を持たない場合は共通のプレースホルダーアイコンを表示する。
//  Web版はクリックで簡易メニュー(名前表示＋サインアウト)を開くが、SwiftUIでは
//  同じ役割を `Menu` で代替する。
//

import SwiftUI

struct LoginStatusIcon: View {
    let photoURL: URL?
    let displayName: String?
    let isSignedIn: Bool
    let onSignOut: () -> Void

    private var label: String {
        if isSignedIn {
            return String(
                format: NSLocalizedString("ログイン中: %@", comment: "Login status icon accessibility label"),
                displayName ?? ""
            )
        }
        return String(localized: "未ログイン")
    }

    var body: some View {
        Menu {
            if isSignedIn {
                Text((displayName?.isEmpty == false ? displayName : nil) ?? String(localized: "ニックネーム未設定"))
                Divider()
                Button(role: .destructive, action: onSignOut) {
                    Label(String(localized: "サインアウト"), systemImage: "rectangle.portrait.and.arrow.right")
                }
            } else {
                Text(String(localized: "未ログイン"))
            }
        } label: {
            ZStack {
                Circle().fill(Color.pttPanel)
                Circle().strokeBorder(Color.pttLine, lineWidth: 1)
                photoOrPlaceholder
            }
            .frame(width: 28, height: 28)
        }
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private var photoOrPlaceholder: some View {
        if let photoURL {
            // 画像取得に失敗した場合(オフライン・レート制限等)はプレースホルダーへ
            // フォールバックする(Web版の @error="imageFailed = true" に相当)。
            AsyncImage(url: photoURL) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    placeholderIcon
                }
            }
            .frame(width: 28, height: 28)
            .clipShape(Circle())
        } else {
            placeholderIcon
        }
    }

    private var placeholderIcon: some View {
        Image(systemName: "person.fill")
            .font(.system(size: 11))
            .foregroundColor(.pttMuted)
    }
}
