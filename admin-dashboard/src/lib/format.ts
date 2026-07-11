export function formatTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—'
}
