// [開始/終了時刻] token-server/lib/roomSchedule.js の resolveScheduleState と
// 同じロジックを、admin-dashboard側の表示バッジ用に持たせる。
//
// [同期について] Phase12でのRoom内role判定(3クライアント + lib/permissions.js)
// はビルド時/CIでの機械的一致チェック(scripts/check-role-sync.js)を導入したが、
// この状態表示は「アクセス制御そのもの」ではなく単なる一覧・詳細画面上の
// バッジに過ぎない(実際の可否は毎回サーバーAPI側で判定し直される)ため、
// 同水準の同期保証までは導入していない。ロジック自体が3行程度と単純なため、
// 乖離した場合の実害・気づきやすさの両面でリスクは低いと判断している。

import type { RoomSchedule } from '@/types/admin'

export type ScheduleState = 'before_start' | 'in_session' | 'after_end'

export function resolveScheduleState(schedule: RoomSchedule, atMs = Date.now()): ScheduleState {
  if (schedule.start !== null && schedule.start > atMs) return 'before_start'
  if (schedule.end !== null && schedule.end <= atMs) return 'after_end'
  return 'in_session'
}

export function scheduleStateLabel(state: ScheduleState): string {
  switch (state) {
    case 'before_start':
      return '待機中'
    case 'after_end':
      return '終了(チャット閲覧のみ)'
    default:
      return '実施中'
  }
}

export function scheduleStateBadgeVariant(state: ScheduleState): 'accent' | 'default' | 'destructive' {
  switch (state) {
    case 'in_session':
      return 'accent'
    case 'before_start':
      return 'default'
    default:
      return 'destructive'
  }
}

// [開始/終了時刻] <input type="datetime-local">はローカルタイムゾーンでの
// "YYYY-MM-DDTHH:mm"形式を扱うため、ミリ秒との相互変換をここに共通化する
// (RoomDetailView.vue・RoomsListView.vueの新規作成フォーム両方で使う)。
// 空文字は「未設定(null) = 開始時刻なし即入室可 / 終了時刻なし無期限」。
export function msToDatetimeLocal(ms: number | null): string {
  if (ms === null) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function datetimeLocalToMs(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}
