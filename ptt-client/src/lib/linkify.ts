// [チャットUI刷新] メッセージ本文中のURLをハイパーリンク化するための分割ユーティリティ。
// v-html は使わず、テキスト/リンクのセグメント配列に分解してテンプレート側の
// v-for + Vueのテキスト補間(自動エスケープ)で描画する前提。これによりXSSの
// リスクなしにリンク化できる(本文中に "<script>" 等が含まれていてもそのまま
// テキストとして表示されるだけで実行されない)。

export interface LinkifySegment {
  type: 'text' | 'url'
  value: string
}

// http(s)のみ対象(javascript:等のスキームはリンク化しない)。
// 日本語の全角文字(ひらがな・カタカナ・漢字・全角記号)はURLの構成文字として
// 現れないため、あらかじめマッチ対象から除外しておく。これにより
// 「https://example.com/aです」のように直後に日本語が続くケースでも
// URL部分だけを正しく切り出せる(半角の記号だけは末尾トリム側で処理する)。
const URL_PATTERN = /https?:\/\/[^\s<>"'\u3000-\u303f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]+/g
// 文末に付きがちな半角の句読点・閉じ括弧はURLに含めない
const TRAILING_PUNCTUATION = /[)'".,!?]+$/

export function linkify(text: string): LinkifySegment[] {
  if (!text) return []

  const segments: LinkifySegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    let url = match[0]

    // 末尾の句読点・閉じ括弧はリンクから除外し、テキストとして残す
    const trailingMatch = url.match(TRAILING_PUNCTUATION)
    if (trailingMatch) {
      url = url.slice(0, url.length - trailingMatch[0].length)
    }
    if (!url) continue

    if (start > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, start) })
    }
    segments.push({ type: 'url', value: url })
    lastIndex = start + url.length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments
}
