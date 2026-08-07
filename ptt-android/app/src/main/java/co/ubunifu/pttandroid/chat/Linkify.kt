/**
 * Linkify.kt
 *
 * [チャットUI刷新・五十六訂/五十七訂のAndroid移植]
 * Web版(ptt-client/src/lib/linkify.ts)・iOS版(Linkify.swift)の移植。メッセージ
 * 本文中のURLをテキスト/URLのセグメント配列に分解する。呼び出し側(PTTApp.kt)は
 * これをComposeのAnnotatedStringへ変換し、ClickableTextへ渡す。生のHTML化や
 * WebViewには一切頼らず、テキストの範囲にリンクの注釈を付けるだけなので、
 * Web版がv-htmlを使わずにXSSリスクなしでリンク化しているのと同じ安全性を保てる。
 */
package co.ubunifu.pttandroid.chat

data class LinkifySegment(val kind: Kind, val value: String) {
    enum class Kind { TEXT, URL }
}

object Linkify {
    // http(s)のみ対象(javascript:等のスキームはリンク化しない)。
    // 日本語の全角文字(ひらがな・カタカナ・漢字・全角記号)はURLの構成文字として
    // 現れないため、あらかじめマッチ対象から除外しておく(Web版・iOS版と同じ範囲)。
    // これにより「https://example.com/aです」のように直後に日本語が続くケースでも
    // URL部分だけを正しく切り出せる(半角の記号だけは末尾トリム側で処理する)。
    private val urlRegex = Regex(
        """https?://[^\s<>"'\u3000-\u303f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]+""",
    )

    // 文末に付きがちな半角の句読点・閉じ括弧はURLに含めない
    private val trailingPunctuation = charArrayOf(')', '\'', '"', '.', ',', '!', '?')

    fun segments(text: String): List<LinkifySegment> {
        if (text.isEmpty()) return emptyList()

        val result = mutableListOf<LinkifySegment>()
        var lastIndex = 0

        for (match in urlRegex.findAll(text)) {
            val start = match.range.first
            var url = match.value
            while (url.isNotEmpty() && url.last() in trailingPunctuation) {
                url = url.dropLast(1)
            }
            if (url.isEmpty()) continue

            if (start > lastIndex) {
                result += LinkifySegment(LinkifySegment.Kind.TEXT, text.substring(lastIndex, start))
            }
            result += LinkifySegment(LinkifySegment.Kind.URL, url)
            lastIndex = start + url.length
        }

        if (lastIndex < text.length) {
            result += LinkifySegment(LinkifySegment.Kind.TEXT, text.substring(lastIndex))
        }

        return result
    }
}
