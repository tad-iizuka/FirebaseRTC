// token-server/routes/admin.js が返すレスポンスの型。
// GET /admin/rooms (一覧) / GET /admin/rooms/:roomId (詳細) に加え、
// [Phase8] GET /admin/audit-logs / GET,POST /admin/admins* /
// GET /rooms/:roomId/recordings* も扱う。

export interface AdminRoomSummary {
  roomId: string
  ownerUid: string
  createdAt: number | null
  maxMembers: number | null
  activeMemberCount: number | null
  talkLock: { uid: string; expiresAt: number } | null
  recording: { active: boolean; startedAt: number | null }
  live: { isLive: boolean; numParticipants: number }
}

export interface AdminRoomListResponse {
  rooms: AdminRoomSummary[]
  nextCursor: string | null
}

export interface AdminMember {
  uid: string
  role: 'owner' | 'moderator' | 'member'
  displayName: string
  status: 'active' | 'banned'
  joinedAt: number | null
  bannedAt: number | null
}

export interface AdminLiveParticipant {
  identity: string
  joinedAt: number | null
  isPublishingAudio: boolean
}

export interface AdminRoomDetail {
  roomId: string
  ownerUid: string
  createdAt: number | null
  maxMembers: number | null
  members: AdminMember[]
  talkLock: { uid: string; acquiredAt: number | null; expiresAt: number } | null
  recording: { active: boolean; startedAt: number | null; startedByUid: string | null }
  liveParticipants: AdminLiveParticipant[]
}

// [Phase8] GET /admin/audit-logs

export interface AuditLogEntry {
  logId: string
  actorUid: string
  action: string
  targetRoomId: string | null
  targetUid: string | null
  detail: Record<string, unknown>
  createdAt: number | null
}

export interface AuditLogListResponse {
  logs: AuditLogEntry[]
  nextCursor: string | null
}

// [Phase8] GET /admin/admins, POST /admin/admins/:uid/permissions

export interface AdminUserEntry {
  uid: string
  permissions: string[]
  note: string | null
  grantedAt: number | null
}

export interface AdminUserListResponse {
  admins: AdminUserEntry[]
}

// [Phase8] GET /rooms/:roomId/recordings, GET .../download-url

export interface RecordingEntry {
  recordingId: string
  startedAt: number | null
  endedAt: number | null
  status: string
  startedByUid: string | null
}

export interface RecordingListResponse {
  recordings: RecordingEntry[]
}

export interface DownloadUrlResponse {
  url: string
  expiresInMs: number
}
