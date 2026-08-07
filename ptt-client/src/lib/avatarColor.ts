// [チャットUI刷新] 生成アバター(頭文字)の背景色をuidから決定的に選ぶ。
// 同一人物は常に同じ色になる(セッションをまたいでも安定)。
// tailwind.config.tsで定義済みのCSS変数トークンの上に乗せたいので、
// 生の16進色ではなくクラス名(bg-*/text-*)のペアを返す。ダーク/ライト
// 両テーマで可読になるよう、既存のバッジ/ステータス系で使われている
// 半透明背景+同系色文字のパターンに合わせている。

const AVATAR_PALETTE = [
  'bg-primary/15 text-primary',
  'bg-live/15 text-live',
  'bg-warning/15 text-warning',
  'bg-destructive/15 text-destructive',
  'bg-secondary text-secondary-foreground',
] as const

export function avatarColorClass(uid: string): string {
  let hash = 0
  for (let i = 0; i < uid.length; i++) {
    hash = (hash << 5) - hash + uid.charCodeAt(i)
    hash |= 0 // 32bit整数に丸める
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[index]
}

// 表示名の先頭1文字(サロゲートペア・絵文字も考慮してArray.fromで取り出す)。
// 空文字/未設定時は「?」を使う。
export function avatarInitial(displayName: string | null | undefined): string {
  const trimmed = (displayName ?? '').trim()
  if (!trimmed) return '?'
  return Array.from(trimmed)[0].toUpperCase()
}
