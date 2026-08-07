// token-server (token-server/routes/*.js) が返すレスポンスの型。
// サーバー側の実装が正なので、フィールドを追加する場合は対応するroutesを確認すること。

export interface ServerErrorResponse {
  error: string
  code?: string
}

// [ルーム作成のadmin-dashboard移管] ルーム作成はadmin-dashboard専用の
// POST /admin/rooms(rooms:create権限)に移管し、ptt-client側のPOST /rooms
// (旧CreateRoomResponse)は廃止した。ptt-clientは常に既存ルームへの
// join(招待コード検証)のみを行う。詳細はbrushup-plan.mdのルーム名・
// ルーム作成移管に関する改定を参照。

export interface JoinRoomResponse {
  roomId: string
  joined: true
  role: 'owner' | 'moderator' | 'member' | 'guest'
  autoRecording: boolean
  // [ルーム名] admin-dashboardで設定されたルーム名。未設定の場合はnull。
  name: string | null
}

export interface TokenResponse {
  token: string
  room: string
  identity: string
}

export interface TalkStartResponse {
  acquired: true
  expiresInMs: number
}

export interface TalkStopResponse {
  released: true
}

export interface ChatSendResponse {
  messageId: string
}

/** [Phase16] POST /rooms/:roomId/attachments/upload-url のレスポンス */
export interface AttachmentUploadUrlResponse {
  uploadUrl: string
  storagePath: string
  expiresInMs: number
}

/** [Phase16] GET .../attachment-url ・ .../thumbnail-url のレスポンス */
export interface AttachmentDownloadUrlResponse {
  url: string
  expiresInMs: number
}

export type AttachmentKind = 'image' | 'video' | 'pdf'

/** [Phase16] rooms/{roomId}/messages/{messageId}.attachment のFirestore形状 */
export interface ChatAttachment {
  storagePath: string
  thumbnailPath: string | null
  contentType: string
  kind: AttachmentKind
  fileName: string
  size: number
}

export interface RecordingStartResponse {
  started: true
  egressId: string
}

export interface RecordingStopResponse {
  stopping?: true
  stopped?: true
}

export type ScheduleState = 'before_start' | 'in_session' | 'after_end'

export interface RoomSchedule {
  start: number | null
  end: number | null
}

export interface RecordingStatusResponse {
  active: boolean
  startedAt: number | null
  autoRecording: boolean
  // [ルーム名] /join を経由しない再入室時にもルーム名を最新化できるよう、
  // このエンドポイントにも同居させている(autoRecordingと同じ理由。room.ts参照)。
  name: string | null
  // [開始/終了時刻] 同じ理由で、再入室のたびに待機画面/通常画面/
  // チャット閲覧専用画面のどれを出すか判定し直せるようにしている。
  schedule: RoomSchedule
  scheduleState: ScheduleState
}

export interface RoomSettingsResponse {
  roomId: string
  autoRecording: boolean
}

/** PATCH /rooms/:roomId/nickname のレスポンス */
export interface NicknameResponse {
  roomId: string
  displayName: string
}

export interface BanResponse {
  roomId: string
  targetUid: string
  banned: true
}

export interface ReportResponse {
  reportId: string
}

/** rooms/{roomId}/members/{uid} のFirestoreドキュメント形状 */
export interface RoomMember {
  role: 'owner' | 'moderator' | 'member' | 'guest'
  displayName: string
  status: 'active' | 'banned'
}

/** rooms/{roomId}/messages/{messageId} のFirestoreドキュメント形状 */
// [チャットUI刷新] role/photoUrlは送信時点のスナップショット(後からのrole変更・
// プロフィール写真設定は過去メッセージに遡及しない)。古いメッセージには
// roleフィールド自体が無い可能性があるためoptionalにしておく。
export type ChatSenderRole = 'owner' | 'moderator' | 'member' | 'guest'

export interface ChatMessageDoc {
  uid: string
  displayName: string
  role?: ChatSenderRole
  photoUrl?: string | null
  text: string
  createdAt: { toDate: () => Date } | null
  // [Phase16] 添付が無いメッセージにはフィールド自体が存在しない
  attachment?: ChatAttachment
}

export interface ChatMessage {
  id: string
  uid: string
  displayName: string
  role?: ChatSenderRole
  photoUrl?: string | null
  text: string
  createdAt: Date | null
  attachment?: ChatAttachment
}

/** サーバー(routes/talk.js)がLiveKit Room Metadataへ書き込む形状 */
export interface RoomMetadataPayload {
  currentTalker: string | null
  recording: { active: boolean; startedAt: number | null }
  updatedAt: number
}

// [Phase13] GET /rooms/:roomId/badges のレスポンス。
// badges/badgeGrantsはfirestore.rulesで直接読み取りを禁止しているため、
// このAPIが唯一の取得経路(lib/badges.js参照)。
export interface AssignedBadge {
  badgeId: string
  name: string
  icon: string
  category: 'role' | 'skill' | 'unit' | 'rank' | 'other'
  priority: number
  source: 'grant' | 'guest-role'
}

export interface RoomMemberBadges {
  badges: AssignedBadge[]
  topBadge: AssignedBadge | null
}

// [2026-08-04] Room内owner向け「付与できるバッジ」の選択肢。owner以外には
// nullが返る(lib/badges.js listRoomOwnerGrantableBadges参照。管理者向けの
// autoGrantCondition等は含めない最小フィールドのみ)。
export interface GrantableBadge {
  badgeId: string
  name: string
  icon: string
  category: 'role' | 'skill' | 'unit' | 'rank' | 'other'
}

export interface RoomBadgesResponse {
  roomId: string
  members: Record<string, RoomMemberBadges>
  grantableBadges: GrantableBadge[] | null
}

// [Phase12→パンくず実装] GET /rooms/:roomId/org-context のレスポンス
// (lib/orgContext.jsのresolveOrgContext()参照)。無所属Roomはエラーではなく
// orgId: null + breadcrumb: [] を返す。
export interface OrgBreadcrumbNode {
  nodeId: string
  name: string
  depth: number
}

export interface OrgContextResponse {
  orgId: string | null
  orgName: string | null
  breadcrumb: OrgBreadcrumbNode[]
}
