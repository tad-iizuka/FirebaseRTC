// token-server/routes/admin.js が返すレスポンスの型。
// GET /admin/rooms (一覧) / GET /admin/rooms/:roomId (詳細) に加え、
// [Phase8] GET /admin/audit-logs / GET,POST /admin/admins* /
// GET /rooms/:roomId/recordings* も扱う。
// [Phase11] 組織階層(organizations/nodes)関連の型もここに追加している。

export interface AdminRoomSummary {
  roomId: string
  // [ルーム名] admin-dashboardから設定・変更できるルーム名。未設定はnull。
  name: string | null
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
  // [ルーム名] PATCH /admin/rooms/:roomId/name (rooms:manage権限) で変更できる。
  name: string | null
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

// [ルーム作成のadmin-dashboard移管]
// POST /admin/rooms (rooms:create権限)。ptt-client側のPOST /rooms
// (旧CreateRoomResponse)を廃止し、ルーム作成はここに一本化した。
// 呼び出した管理者自身がownerになる(POST /rooms時代と同じ、呼び出し
// ユーザーがownerになるという設計を踏襲)。招待コードはこのレスポンス
// でのみ返却され、以降どのAPIからも再取得できない(brushup-plan.md 5.4の
// 「招待コードの可視範囲」課題と同じ制約)ため、UI側で作成直後に必ず
// 表示・コピーできるようにする(RoomsListView.vue参照)。
export interface AdminCreateRoomResponse {
  roomId: string
  name: string | null
  inviteCode: string
  ownerUid: string
  createdAt: number | null
  maxMembers: number | null
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
  // [Phase16] チャット添付ファイルの保持期間(日数)。未設定はnull(デフォルト30日が適用される)。
  attachmentRetentionDays: number | null
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

// [Phase13] GET/POST/PATCH /admin/badges*, GET/PATCH /admin/config/badge-display,
// GET/POST/DELETE /admin/rooms/:roomId/badges* (badges:monitor / badges:manage)
// 団体スコープを持たない全体共通マスタ(brushup-plan.md 6.1 item14で確定)。

export type BadgeCategory = 'role' | 'skill' | 'unit' | 'rank' | 'other'
export type BadgeGrantMethod = 'manual' | 'auto' | 'both'

export interface AdminBadge {
  badgeId: string
  name: string
  icon: string
  description: string | null
  category: BadgeCategory
  grantMethod: BadgeGrantMethod
  // Phase13で先行実装するのは業種非依存の最小条件のみ(phase13-badge-schema.md「2.1」)。
  // 中身の型はバッジごとに異なりうるため、管理画面では生JSONとして扱う。
  autoGrantCondition: Record<string, unknown> | null
  priority: number
  active: boolean
  createdAt: number | null
  updatedAt: number | null
  createdBy: string
}

export interface AdminBadgeListResponse {
  badges: AdminBadge[]
}

export interface BadgeDisplayConfig {
  maxDisplayCount: number
  updatedAt: number | null
  updatedBy: string | null
}

// [Guestの役割バッジ] badgeGrantsへ永続化されない仮想バッジも同じ形で返る
// (source: 'guest-role')。'grant' は通常のbadgeGrantsに基づく付与。
export interface AssignedBadge {
  badgeId: string
  name: string
  icon: string
  category: BadgeCategory
  priority: number
  source: 'grant' | 'guest-role'
}

export interface RoomMemberBadges {
  badges: AssignedBadge[]
  topBadge: AssignedBadge | null
}

export interface RoomBadgesResponse {
  roomId: string
  members: Record<string, RoomMemberBadges>
}

export interface BadgeGrantResult {
  grantId: string
  uid: string
  badgeId: string
}

// GET /admin/users, GET /admin/users/:uid, POST/DELETE /admin/users/:uid/badges*
// (users:monitor / badges:manage)。2026-07-27新設。
//
// [命名について] 既存の`AdminUserEntry`/`AdminUserListResponse`(上記)は
// 「サイト管理者権限を持つ人(adminUsers/{uid}.permissions)」を指す別概念
// (AdminsView.vue「管理者権限」タブ)であり、ここで扱うのは一般の
// Firebase Authユーザー(主にMember)なので、名前が衝突しないよう
// `AppUser*`という別プレフィックスにしている。
//
// [設計] バッジ付与/剥奪はもともとRoomDetailView.vueのメンバー台帳から
// 行っていたが、badgeGrantsがそもそもRoomに紐付かないユーザー単位の
// レコードである以上、Room文脈から付与するのは不自然というユーザー指摘を
// 受けて、この「ユーザー管理」画面に一本化した(brushup-plan.md参照)。
// 将来のユーザー無効化等、他のユーザー単位の管理操作もここに追加していく
// ことを見込んだ、拡張しやすい構成にしている。
export interface AppUserSummary {
  uid: string
  email: string | null
  isGuest: boolean
  disabled: boolean
  createdAt: string | null
  lastSignInAt: string | null
}

export interface AppUserListResponse {
  users: AppUserSummary[]
  nextPageToken: string | null
}

export interface AppUserProfile extends AppUserSummary {
  badges: AssignedBadge[]
  topBadge: AssignedBadge | null
}
