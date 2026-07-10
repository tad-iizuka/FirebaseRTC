import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch } from '@/lib/api'
import type { CreateRoomResponse } from '@/types/api'

// [招待制ルーム対応]
// token-server は「ルームIDを知っていれば誰でも入れる」設計ではなく、
// invite_only(招待制)になっている。/token を取得する前に、必ず
//   - POST /rooms            (ルーム作成。呼び出しユーザーがownerになる)
//   - POST /rooms/:roomId/join  (招待コードを検証してmembersに追加)
// のいずれかでルームのメンバーになっている必要がある(token-server/routes/rooms.js)。
// iOS版 PTTRoomManager.swift / Android版 PTTRoomManager.kt と同じ役割。

export const useRoomStore = defineStore('room', () => {
  const isWorking = ref(false)
  const errorMessage = ref<string | null>(null)

  /** 現在入室中のルームID。未入室(ルーム選択画面)の間は null。 */
  const currentRoomId = ref<string | null>(null)
  /** 自分がowner(作成者)の場合のみセットされる、参加者への共有用招待コード。 */
  const currentInviteCode = ref<string | null>(null)

  function clearError() {
    errorMessage.value = null
  }

  async function createRoom(baseUrl: string, maxMembers?: number): Promise<CreateRoomResponse> {
    isWorking.value = true
    errorMessage.value = null
    try {
      const data = await authedFetch<CreateRoomResponse>(baseUrl, '/rooms', {
        method: 'POST',
        body: maxMembers ? { maxMembers } : {},
      })
      currentRoomId.value = data.roomId
      currentInviteCode.value = data.inviteCode
      return data
    } catch (e) {
      errorMessage.value = (e as Error).message
      throw e
    } finally {
      isWorking.value = false
    }
  }

  async function joinRoom(baseUrl: string, roomId: string, inviteCode: string): Promise<void> {
    isWorking.value = true
    errorMessage.value = null
    try {
      await authedFetch(baseUrl, `/rooms/${encodeURIComponent(roomId)}/join`, {
        method: 'POST',
        body: { inviteCode },
      })
      currentRoomId.value = roomId
      // 参加者自身が入力した招待コードをそのまま保持し、以後も表示できるようにする
      currentInviteCode.value = inviteCode
    } catch (e) {
      errorMessage.value = (e as Error).message
      throw e
    } finally {
      isWorking.value = false
    }
  }

  /** 保存済みのルームへ再入室する場合: 招待コード検証は経由せず、既にメンバーである前提で進む。 */
  function reenter(roomId: string, inviteCode: string | null) {
    currentRoomId.value = roomId
    currentInviteCode.value = inviteCode
  }

  function leave() {
    currentRoomId.value = null
    currentInviteCode.value = null
  }

  return {
    isWorking,
    errorMessage,
    currentRoomId,
    currentInviteCode,
    clearError,
    createRoom,
    joinRoom,
    reenter,
    leave,
  }
})
