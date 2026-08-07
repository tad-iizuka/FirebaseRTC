//
//  Linkify.swift
//  ptt-ios
//
//  [チャットUI刷新・五十六訂のiOS移植]
//  Web版(ptt-client/src/lib/linkify.ts)の移植。メッセージ本文中のURLを
//  テキスト/URLのセグメント配列に分解する。呼び出し側(ContentView.swift)は
//  これをAttributedStringに変換して`Text`へ渡す。SwiftUIの`Text`は
//  `AttributedString`の`.link`属性を自動的にタップ可能なリンクとして扱うため、
//  Web版がv-htmlを使わずXSSリスクなしにリンク化しているのと同様、
//  ここでも文字列を直接評価するだけで安全に実現できる。
//

import Foundation

struct LinkifySegment: Equatable {
    enum Kind: Equatable { case text, url }
    let kind: Kind
    let value: String
}

enum Linkify {
    // http(s)のみ対象(javascript:等のスキームはリンク化しない)。
    // 日本語の全角文字(ひらがな・カタカナ・漢字・全角記号)はURLの構成文字として
    // 現れないため、あらかじめマッチ対象から除外しておく。これにより
    // 「https://example.com/aです」のように直後に日本語が続くケースでも
    // URL部分だけを正しく切り出せる(半角の記号だけは末尾トリム側で処理する)。
    private static let urlRegex: NSRegularExpression = {
        // \u3000-\u303f: 全角記号・句読点類, \u3040-\u30ff: ひらがな・カタカナ,
        // \u4e00-\u9fff: 漢字, \uff00-\uffef: 全角英数・記号
        let pattern = #"https?://[^\s<>"'\x{3000}-\x{303f}\x{3040}-\x{30ff}\x{4e00}-\x{9fff}\x{ff00}-\x{ffef}]+"#
        return try! NSRegularExpression(pattern: pattern)
    }()

    // 文末に付きがちな半角の句読点・閉じ括弧はURLに含めない
    private static let trailingPunctuation: CharacterSet = CharacterSet(charactersIn: ")'\".,!?")

    static func segments(from text: String) -> [LinkifySegment] {
        guard !text.isEmpty else { return [] }

        var result: [LinkifySegment] = []
        let nsText = text as NSString
        let fullRange = NSRange(location: 0, length: nsText.length)
        var lastIndex = 0

        urlRegex.enumerateMatches(in: text, range: fullRange) { match, _, _ in
            guard let match else { return }
            var matchRange = match.range
            var url = nsText.substring(with: matchRange)

            while let last = url.unicodeScalars.last, trailingPunctuation.contains(last) {
                url.removeLast()
                matchRange.length -= 1
            }
            guard !url.isEmpty else { return }

            if matchRange.location > lastIndex {
                let textRange = NSRange(location: lastIndex, length: matchRange.location - lastIndex)
                result.append(LinkifySegment(kind: .text, value: nsText.substring(with: textRange)))
            }
            result.append(LinkifySegment(kind: .url, value: url))
            lastIndex = matchRange.location + matchRange.length
        }

        if lastIndex < nsText.length {
            let remainingRange = NSRange(location: lastIndex, length: nsText.length - lastIndex)
            result.append(LinkifySegment(kind: .text, value: nsText.substring(with: remainingRange)))
        }

        return result
    }
}
