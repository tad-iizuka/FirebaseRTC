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
  role: 'owner' | 'moderator' | 'member'
  displayName: string
  status: 'active' | 'banned'
}

/** rooms/{roomId}/messages/{messageId} のFirestoreドキュメント形状 */
export interface ChatMessageDoc {
  uid: string
  displayName: string
  text: string
  createdAt: { toDate: () => Date } | null
}

export interface ChatMessage {
  id: string
  uid: string
  displayName: string
  text: string
  createdAt: Date | null
}

/** サーバー(routes/talk.js)がLiveKit Room Metadataへ書き込む形状 */
export interface RoomMetadataPayload {
  currentTalker: string | null
  recording: { active: boolean; startedAt: number | null }
  updatedAt: number
}
