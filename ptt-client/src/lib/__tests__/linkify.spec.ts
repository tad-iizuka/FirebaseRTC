import { describe, expect, it } from 'vitest'
import { linkify } from '@/lib/linkify'

describe('linkify', () => {
  it('returns a single text segment when there is no URL', () => {
    expect(linkify('こんにちは')).toEqual([{ type: 'text', value: 'こんにちは' }])
  })

  it('extracts a URL surrounded by text', () => {
    expect(linkify('地図はこちら https://example.com/site-a です')).toEqual([
      { type: 'text', value: '地図はこちら ' },
      { type: 'url', value: 'https://example.com/site-a' },
      { type: 'text', value: ' です' },
    ])
  })

  it('does not swallow trailing Japanese punctuation into the URL', () => {
    expect(linkify('見て。https://example.com/a。おわり')).toEqual([
      { type: 'text', value: '見て。' },
      { type: 'url', value: 'https://example.com/a' },
      { type: 'text', value: '。おわり' },
    ])
  })

  it('handles multiple URLs in one message', () => {
    const result = linkify('https://a.example.com and https://b.example.com')
    expect(result.filter((s) => s.type === 'url').map((s) => s.value)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })

  it('ignores non-http(s) schemes', () => {
    expect(linkify('javascript:alert(1)')).toEqual([{ type: 'text', value: 'javascript:alert(1)' }])
  })

  it('returns an empty array for empty input', () => {
    expect(linkify('')).toEqual([])
  })
})
