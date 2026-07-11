// token-server/routes/admin.js が返すレスポンスの型。
// GET /admin/rooms (一覧) / GET /admin/rooms/:roomId (詳細) の2エンドポイント分。

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
