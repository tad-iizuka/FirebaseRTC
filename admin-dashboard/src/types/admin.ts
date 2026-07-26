// token-server/routes/admin.js が返すレスポンスの型。
// GET /admin/rooms (一覧) / GET /admin/rooms/:roomId (詳細) に加え、
// [Phase8] GET /admin/audit-logs / GET,POST /admin/admins* /
// GET /rooms/:roomId/recordings* も扱う。
// [Phase11] 組織階層(organizations/nodes)関連の型もここに追加している。

export interface AdminRoomSummary {
  roomId: string
  ownerUid: string
  createdAt: number | null
  maxMembers: number | null
  activeMemberCount: number | null
  // [Phase11] 一覧では名前解決していない生ID。名前が要る場合は
  // useAdminOrganizationsStore で取得済みの一覧と突き合わせる
  // (RoomsListView.vue参照)。
  orgId: string | null
  nodeId: string | null
  nodeAncestorIds: string[]
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
  role: 'owner' | 'moderator' | 'member' | 'guest'
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

// [Phase11] lib/orgContext.js が解決する、名前付きのパンくず情報。
// ルートに近い順(depth昇順)に並ぶ。
export interface OrgBreadcrumbEntry {
  nodeId: string
  name: string
  depth: number
}

export interface RoomOrgContext {
  orgId: string | null
  orgName: string | null
  breadcrumb: OrgBreadcrumbEntry[]
}

export interface AdminRoomDetail {
  roomId: string
  ownerUid: string
  createdAt: number | null
  maxMembers: number | null
  members: AdminMember[]
  // [Phase11] 無所属の場合は { orgId: null, orgName: null, breadcrumb: [] }
  org: RoomOrgContext
  talkLock: { uid: string; acquiredAt: number | null; expiresAt: number } | null
  recording: { active: boolean; startedAt: number | null; startedByUid: string | null }
  liveParticipants: AdminLiveParticipant[]
  // [設定] rooms/:roomId/settings/autoRecording (Firestore) を表す。
  // 参加者が集まったら自動的に録音を開始するかどうかのルーム単位フラグ。
  settings: { autoRecording: boolean }
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

// [Phase11] GET /admin/organizations, GET /admin/organizations/:orgId/nodes,
// POST /admin/organizations, POST /admin/organizations/:orgId/nodes,
// PATCH /admin/rooms/:roomId/org-assignment

export interface AdminOrganization {
  orgId: string
  name: string
  industryProfile: string | null
  ownerUid: string
  // 都度Aggregation Queryで集計しているため、取得に失敗した場合はnull。
  roomCount: number | null
  createdAt: number | null
}

export interface AdminOrganizationListResponse {
  organizations: AdminOrganization[]
}

export interface AdminOrgNode {
  nodeId: string
  name: string
  parentNodeId: string | null
  depth: number
}

export interface AdminOrgNodeListResponse {
  nodes: AdminOrgNode[]
}

export interface RoomOrgAssignment {
  roomId: string
  orgId: string | null
  nodeId: string | null
  nodeAncestorIds: string[]
}
