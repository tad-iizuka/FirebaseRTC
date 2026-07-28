import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authedFetch } from '@/lib/api'
import type { RecordingStatusResponse, RoomSettingsResponse } from '@/types/api'

// [招待制ルーム対応]
// token-server は「ルームIDを知っていれば誰でも入れる」設計ではなく、
// invite_only(招待制)になっている。/token を取得する前に、必ず
//   - POST /rooms/:roomId/join  (招待コードを検証してmembersに追加)
// でルームのメンバーになっている必要がある(token-server/routes/rooms.js)。
// iOS版 PTTRoomManager.swift / Android版 PTTRoomManager.kt と同じ役割。
//
// [ルーム作成のadmin-dashboard移管] 以前はここに createRoom() (POST /rooms)
// があったが、ルーム作成はadmin-dashboard専用の POST /admin/rooms
// (rooms:create権限)へ移管した。ptt-client側からはルームを作成できない
// (brushup-plan.md参照)。

export const useRoomStore = defineStore('room', () => {
  const isWorking = ref(false)
  const errorMessage = ref<string | null>(null)

  /** 現在入室中のルームID。未入室(ルーム選択画面)の間は null。 */
  const currentRoomId = ref<string | null>(null)
  /** 自分がowner(作成者)の場合のみセットされる、参加者への共有用招待コード。 */
  const currentInviteCode = ref<string | null>(null)
  // [ルーム名] admin-dashboardで設定されたルーム名。未設定 or 未取得の場合はnull。
  // autoRecordingと同じ理由で、/join のレスポンスと GET /recording/status の
  // 両方から取得できるようにしている(reenter時は後者のみで最新化する)。
  const currentRoomName = ref<string | null>(null)

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

  async function joinRoom(baseUrl: string, roomId: string, inviteCode: string): Promise<void> {
    isWorking.value = true
    errorMessage.value = null
    try {
      const data = await authedFetch<{
        roomId: string
        joined: true
        autoRecording: boolean
        name: string | null
      }>(baseUrl, `/rooms/${encodeURIComponent(roomId)}/join`, {
        method: 'POST',
        body: { inviteCode },
      })
      currentRoomId.value = roomId
      // 参加者自身が入力した招待コードをそのまま保持し、以後も表示できるようにする
      currentInviteCode.value = inviteCode
      autoRecording.value = data.autoRecording
      currentRoomName.value = data.name
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
    // /join を経由しないため、autoRecording・ルーム名は未取得の状態からスタートする。
    // fetchAutoRecording() を呼んで最新値を取り直す想定(RoomView#enter参照)。
    autoRecording.value = null
    currentRoomName.value = null
  }

  /**
   * 現在の autoRecording 設定値・ルーム名をサーバーから取得し直す。
   * /join を経由しない再入室時や、他のowner/moderatorやadmin-dashboardが
   * 設定を変更した可能性がある場合の最新化に使う(GET /recording/status に相乗り)。
   */
  async function fetchAutoRecording(baseUrl: string, roomId: string) {
    autoRecordingLoading.value = true
    try {
      const data = await authedFetch<RecordingStatusResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/recording/status`,
      )
      autoRecording.value = data.autoRecording
      currentRoomName.value = data.name
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
    currentRoomName.value = null
    autoRecording.value = null
    autoRecordingErrorMessage.value = null
  }

  return {
    isWorking,
    errorMessage,
    currentRoomId,
    currentInviteCode,
    currentRoomName,
    autoRecording,
    autoRecordingLoading,
    autoRecordingErrorMessage,
    clearError,
    joinRoom,
    reenter,
    fetchAutoRecording,
    setAutoRecording,
    leave,
  }
})
