// 招待リンクの生成ユーティリティ(生成側のみ。読み取り・解析はptt-client側)。
// フォーマットはptt-client/src/lib/inviteLink.tsと一致させること:
//   https://<ptt-clientのホスト>/r?room=<roomId>&code=<inviteCode>
//
// ptt-clientのデプロイ先ホストは、admin-dashboardの実行時設定からは分からないため
// (別Firebase Hostingターゲット)、環境変数で明示的に持たせる。

const PTT_CLIENT_ORIGIN = import.meta.env.VITE_PTT_CLIENT_ORIGIN ?? 'https://fir-rtc-de1f4.web.app'

export function buildInviteLink(roomId: string, inviteCode: string): string {
  const url = new URL('/r', PTT_CLIENT_ORIGIN)
  url.searchParams.set('room', roomId)
  url.searchParams.set('code', inviteCode)
  return url.toString()
}
