// 招待リンク（Universal Link / App Link）の生成・解析ユーティリティ。
// admin-dashboardが生成するリンクと同じフォーマットを共有する。
// フォーマット: https://<ptt-client host>/r?room=<roomId>&code=<inviteCode>
//
// 設計方針（brushup-plan.md 十四訂 相当、deeplink-qr-join-plan.md参照）:
// - このリンク/QRを開いても自動参加はしない。あくまでRoom ID・招待コード入力欄への
//   自動入力のみを行う。
// - iOS/AndroidともUniversal Link / App Linkとしてこのホストを検証登録する前提のため、
//   パス・クエリキー名はネイティブ側(ptt_iosApp.swift / MainActivity.kt)とも一致させること。

export const JOIN_REDIRECT_PATH = '/r'

export interface ParsedInvite {
  roomId: string
  inviteCode: string
}

/** 招待リンクの文字列(絶対URL)を組み立てる。admin-dashboard側にも同等の実装がある。 */
export function buildInviteLink(origin: string, roomId: string, inviteCode: string): string {
  const url = new URL(JOIN_REDIRECT_PATH, origin)
  url.searchParams.set('room', roomId)
  url.searchParams.set('code', inviteCode)
  return url.toString()
}

/**
 * 絶対URL文字列から room/code を取り出す。
 * QRスキャナーが読み取った生文字列(URLとは限らない)にも使うため、
 * URLとして解釈できない場合はnullを返す(呼び出し側で「読み取り失敗」として扱う)。
 */
export function parseInviteLink(text: string): ParsedInvite | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const roomId = url.searchParams.get('room')
  const inviteCode = url.searchParams.get('code')
  if (!roomId || !inviteCode) return null
  return { roomId, inviteCode }
}

/** RedirectJoinView → RoomSelectView へ受け渡すための一時領域キー(sessionStorage)。 */
export const PENDING_JOIN_STORAGE_KEY = 'ptt.pendingJoin'

export function savePendingJoin(invite: ParsedInvite) {
  try {
    sessionStorage.setItem(PENDING_JOIN_STORAGE_KEY, JSON.stringify(invite))
  } catch {
    // sessionStorageが使えない環境(プライベートブラウズ等)では諦める。
    // 手入力へフォールバックするだけなので致命的ではない。
  }
}

export function consumePendingJoin(): ParsedInvite | null {
  try {
    const raw = sessionStorage.getItem(PENDING_JOIN_STORAGE_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PENDING_JOIN_STORAGE_KEY)
    const parsed = JSON.parse(raw)
    if (typeof parsed?.roomId === 'string' && typeof parsed?.inviteCode === 'string') {
      return { roomId: parsed.roomId, inviteCode: parsed.inviteCode }
    }
    return null
  } catch {
    return null
  }
}
