//
//  PTTOnboardingView.swift
//  PTTClient
//
//  [オンボーディング]
//  Web版(ptt-client/src/components/OnboardingFlow.vue)と同じ4枚構成の
//  スワイプ形式イントロ画面。TabView(.page)でスワイプ・ページングを実現し、
//  下部に自前のドットインジケーターと 戻る/次へ(最後は「はじめる」) ボタンを
//  配置する。配色はColor+Tokens.swiftのトークンをそのまま使い、Web版と同じ
//  文言・スライド構成で3プラットフォーム間の体験を揃えている。
//

import SwiftUI
import Foundation

private struct PTTOnboardingSlide {
    let systemImage: String
    let title: LocalizedStringKey
    let description: LocalizedStringKey
}

private let pttOnboardingSlides: [PTTOnboardingSlide] = [
    PTTOnboardingSlide(
        systemImage: "dot.radiowaves.left.and.right",
        title: "PTT Client へようこそ",
        description: "トランシーバーのように、押している間だけ声が届くシンプルな音声チャットです。"
    ),
    PTTOnboardingSlide(
        systemImage: "door.left.hand.open",
        title: "ルームを作成・参加",
        description: "ルームは招待制です。自分でルームを作成するか、招待コードを受け取って参加しましょう。"
    ),
    PTTOnboardingSlide(
        systemImage: "mic.fill",
        title: "ボタンを押して話す",
        description: "中央のPTTボタンを押している間だけ音声が送信されます。誰かが話している間は自動的に送話が待機状態になります。"
    ),
    PTTOnboardingSlide(
        systemImage: "bubble.left.and.bubble.right.fill",
        title: "チャットと参加者管理",
        description: "テキストチャットや参加者一覧に加え、モデレーター向けのBAN・通報機能も使えます。"
    ),
]

struct PTTOnboardingView: View {

    /// 最後まで進める/スキップする、いずれの場合もこれが呼ばれる。
    /// 呼び出し側(ContentView)が PTTOnboardingStore.complete() を呼ぶ。
    let onComplete: () -> Void

    @State private var pageIndex = 0

    private var isFirst: Bool { pageIndex == 0 }
    private var isLast: Bool { pageIndex == pttOnboardingSlides.count - 1 }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button("スキップ", action: onComplete)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.pttMuted)
            }
            .padding(14)

            TabView(selection: $pageIndex) {
                ForEach(Array(pttOnboardingSlides.enumerated()), id: \.offset) { index, slide in
                    slideView(slide)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            dotsIndicator
                .padding(.bottom, 14)

            HStack(spacing: 12) {
                Button {
                    guard !isFirst else { return }
                    withAnimation { pageIndex -= 1 }
                } label: {
                    Text("戻る")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                }
                .buttonStyle(.plain)
                .overlay(RoundedRectangle(cornerRadius: 2).stroke(.pttLine, lineWidth: 1))
                .foregroundColor(.pttMuted)
                .opacity(isFirst ? 0.35 : 1.0)
                .disabled(isFirst)

                Button {
                    if isLast {
                        onComplete()
                    } else {
                        withAnimation { pageIndex += 1 }
                    }
                } label: {
                    Text(isLast ? String(localized: "はじめる") : String(localized: "次へ"))
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                }
                .buttonStyle(.plain)
                .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color.pttAccent, lineWidth: 1))
                .foregroundColor(.pttAccent)
            }
            .padding(14)
        }
        .background(.pttBackground)
        .foregroundColor(.pttText)
    }

    private var dotsIndicator: some View {
        HStack(spacing: 6) {
            ForEach(pttOnboardingSlides.indices, id: \.self) { i in
                Capsule()
                    .fill(i == pageIndex ? Color.pttAccent : Color.pttLine)
                    .frame(width: i == pageIndex ? 20 : 6, height: 6)
                    .animation(.easeInOut, value: pageIndex)
            }
        }
    }

    private func slideView(_ slide: PTTOnboardingSlide) -> some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: slide.systemImage)
                .font(.system(size: 44, weight: .light))
                .foregroundColor(.pttAccent)
            Text(slide.title)
                .font(.system(size: 16, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
            Text(slide.description)
                .font(.system(size: 13, design: .monospaced))
                .foregroundColor(.pttMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

#Preview {
    PTTOnboardingView(onComplete: {})
}
