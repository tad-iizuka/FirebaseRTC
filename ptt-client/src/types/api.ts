// token-server (token-server/routes/*.js) が返すレスポンスの型。
// サーバー側の実装が正なので、フィールドを追加する場合は対応するroutesを確認すること。

export interface ServerErrorResponse {
  error: string
  code?: string
}

export interface CreateRoomResponse {
  roomId: string
  inviteCode: string
}

export interface JoinRoomResponse {
  roomId: string
  joined: true
  role: 'owner' | 'moderator' | 'member' | 'guest'
  autoRecording: boolean
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

export interface RecordingStatusResponse {
  active: boolean
  startedAt: number | null
  autoRecording: boolean
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
export interface ChatMessageDoc {
  uid: string
  displayName: string
  text: string
  createdAt: { toDate: () => Date } | null
  // [Phase16] 添付が無いメッセージにはフィールド自体が存在しない
  attachment?: ChatAttachment
}

export interface ChatMessage {
  id: string
  uid: string
  displayName: string
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

export interface RoomBadgesResponse {
  roomId: string
  members: Record<string, RoomMemberBadges>
}
