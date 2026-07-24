import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch } from '@/lib/api'
import type {
  CreateRoomResponse,
  RecordingStatusResponse,
  RoomSettingsResponse,
} from '@/types/api'

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

  // [Phase9: 自動録音]
  // ルームがアクティブになった瞬間(誰かが最初に入室した瞬間)に録音を
  // 自動開始するかどうかの設定(token-server/routes/webhooks.js参照)。
  // null = まだ取得できていない(入室直後の一瞬など)。owner/moderatorの
  // トグル操作用途と、全参加者への事前開示(入室前バナー表示)の両方で使う。
  const autoRecording = ref<boolean | null>(null)
  const autoRecordingLoading = ref(false)
  const autoRecordingErrorMessage = ref<string | null>(null)

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
      // ルーム作成直後はサーバー側のデフォルト値(false)と一致している
      autoRecording.value = false
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
      const data = await authedFetch<{ roomId: string; joined: true; autoRecording: boolean }>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/join`,
        {
          method: 'POST',
          body: { inviteCode },
        },
      )
      currentRoomId.value = roomId
      // 参加者自身が入力した招待コードをそのまま保持し、以後も表示できるようにする
      currentInviteCode.value = inviteCode
      autoRecording.value = data.autoRecording
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
    // /join を経由しないため、autoRecordingは未取得の状態からスタートする。
    // fetchAutoRecording() を呼んで最新値を取り直す想定(RoomView#enter参照)。
    autoRecording.value = null
  }

  /**
   * 現在の autoRecording 設定値をサーバーから取得し直す。
   * /join を経由しない再入室時や、他のowner/moderatorが設定を変更した
   * 可能性がある場合の最新化に使う(GET /recording/status に相乗り)。
   */
  async function fetchAutoRecording(baseUrl: string, roomId: string) {
    autoRecordingLoading.value = true
    try {
      const data = await authedFetch<RecordingStatusResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/recording/status`,
      )
      autoRecording.value = data.autoRecording
    } catch (e) {
      // 取得失敗してもPTT自体の利用は継続できるため、エラーはログ用途に留める
      autoRecordingErrorMessage.value = (e as Error).message
    } finally {
      autoRecordingLoading.value = false
    }
  }

  /** owner/moderatorが自動録音のon/offを切り替える。 */
  async function setAutoRecording(baseUrl: string, roomId: string, value: boolean) {
    autoRecordingLoading.value = true
    autoRecordingErrorMessage.value = null
    try {
      const data = await authedFetch<RoomSettingsResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/settings`,
        {
          method: 'PATCH',
          body: { autoRecording: value },
        },
      )
      autoRecording.value = data.autoRecording
    } catch (e) {
      autoRecordingErrorMessage.value = (e as Error).message
      throw e
    } finally {
      autoRecordingLoading.value = false
    }
  }

  function leave() {
    currentRoomId.value = null
    currentInviteCode.value = null
    autoRecording.value = null
    autoRecordingErrorMessage.value = null
  }

  return {
    isWorking,
    errorMessage,
    currentRoomId,
    currentInviteCode,
    autoRecording,
    autoRecordingLoading,
    autoRecordingErrorMessage,
    clearError,
    createRoom,
    joinRoom,
    reenter,
    fetchAutoRecording,
    setAutoRecording,
    leave,
  }
})
