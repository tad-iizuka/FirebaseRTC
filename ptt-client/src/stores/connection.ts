import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  ConnectionState,
  Room,
  RoomEvent,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteTrack,
  type Participant,
  type TrackPublication,
  Track,
} from 'livekit-client'
import { authedFetch } from '@/lib/api'
import type { RoomMetadataPayload, TalkStartResponse, TokenResponse } from '@/types/api'

// [LiveKit移行]
// マイク取得・Opusエンコード/デコード・送受信は全てLiveKit SDKの Room オブジェクトが
// 代行するため、このstoreは「トークン取得 → Room接続 → PTTのオン/オフ → 発話ロック連携」の
// 橋渡し役に留まる。iOS版 PTTConnectionManager.swift / Android版
// PTTConnectionManager.kt と同じ設計。
//
// [送話ロック]
// 「誰か1人が話している間は他の人が発話できない」はクライアント側のUI抑制だけでなく、
// サーバー(token-server/routes/talk.js)のFirestoreトランザクションで実効的に強制される。
// PTTボタンはロック取得(/talk/start)に成功して初めてマイクを有効化し、保持中は
// TTL(15秒, サーバー側 LOCK_TTL_MS)より短い間隔でheartbeatを送って延長し続ける。

export type ConnectionStatusKind = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface ParticipantInfo {
  identity: string
  name: string
  muted: boolean
}

// サーバー側の token.js は ttl:'10m' 固定で発行するため、クライアント側もこれに合わせる
// (レスポンスに有効期限が含まれていないため、既知の固定値としてハードコードしている)。
const TOKEN_TTL_SECONDS = 600
const TALK_LOCK_HEARTBEAT_MS = 5000

export const useConnectionStore = defineStore('connection', () => {
  const statusKind = ref<ConnectionStatusKind>('disconnected')
  const statusMessage = ref<string | null>(null)
  const roomName = ref<string | null>(null)

  const participants = ref<Map<string, ParticipantInfo>>(new Map())
  const logLines = ref<string[]>([])
  const isSending = ref(false)
  /** サーバー(routes/talk.js)がRoom Metadataに書き込む現在の発話ロック保持者。 */
  const currentTalkerUid = ref<string | null>(null)

  const isConnected = computed(() => statusKind.value === 'connected')

  let room: Room | null = null
  let tokenServerUrl = ''
  let livekitUrl = ''
  let idTokenProviderRoomId = ''
  let manuallyDisconnected = false
  let tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let talkHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  let pttHeld = false
  let talkRequestToken = 0

  function appendLog(line: string) {
    const time = new Date().toLocaleTimeString()
    logLines.value = [...logLines.value, `[${time}] ${line}`].slice(-200)
  }

  function pttDisabledFor(myUid: string | undefined): boolean {
    const lockedByOther = !!currentTalkerUid.value && currentTalkerUid.value !== myUid
    return !isConnected.value || lockedByOther
  }

  async function fetchToken(roomId: string): Promise<string> {
    const data = await authedFetch<TokenResponse>(tokenServerUrl, `/token?room=${encodeURIComponent(roomId)}`)
    return data.token
  }

  function applyMetadata(metadata: string | undefined) {
    try {
      const parsed = metadata ? (JSON.parse(metadata) as RoomMetadataPayload) : null
      currentTalkerUid.value = parsed?.currentTalker ?? null
    } catch {
      currentTalkerUid.value = null
    }
  }

  function syncParticipantsFromRoom(target: Room) {
    const next = new Map<string, ParticipantInfo>()
    for (const p of target.remoteParticipants.values()) {
      const pub = p.getTrackPublication(Track.Source.Microphone)
      next.set(p.identity, { identity: p.identity, name: p.name || p.identity, muted: !pub || pub.isMuted })
    }
    participants.value = next
  }

  function attachRoomListeners(target: Room) {
    target
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        appendLog(`接続状態: ${state}`)
        if (state === ConnectionState.Disconnected && !manuallyDisconnected) {
          statusKind.value = 'error'
          statusMessage.value = '切断されました'
          stopTalkHeartbeat()
          currentTalkerUid.value = null
          participants.value = new Map()
        } else if (state === ConnectionState.Reconnecting) {
          statusKind.value = 'reconnecting'
        } else if (state === ConnectionState.Connected && statusKind.value === 'reconnecting') {
          statusKind.value = 'connected'
        }
      })
      .on(RoomEvent.RoomMetadataChanged, (metadata: string | undefined) => {
        applyMetadata(metadata)
        appendLog(`[診断] メタデータ更新受信: currentTalker=${currentTalkerUid.value ?? 'null'}`)
      })
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
        appendLog(`参加: ${p.name || p.identity}`)
        const pub = p.getTrackPublication(Track.Source.Microphone)
        participants.value = new Map(participants.value).set(p.identity, {
          identity: p.identity,
          name: p.name || p.identity,
          muted: !pub || pub.isMuted,
        })
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        appendLog(`退出: ${p.name || p.identity}`)
        const next = new Map(participants.value)
        next.delete(p.identity)
        participants.value = next
      })
      .on(
        RoomEvent.TrackSubscribed,
        (_track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
          appendLog(`音声トラック購読開始: ${participant.name || participant.identity}`)
        },
      )
      .on(RoomEvent.TrackMuted, (pub: TrackPublication, participant: Participant) => {
        if (pub.kind === Track.Kind.Audio) {
          const info = participants.value.get(participant.identity)
          if (info)
            participants.value = new Map(participants.value).set(participant.identity, {
              ...info,
              muted: true,
            })
        }
      })
      .on(RoomEvent.TrackUnmuted, (pub: TrackPublication, participant: Participant) => {
        if (pub.kind === Track.Kind.Audio) {
          const info = participants.value.get(participant.identity)
          if (info)
            participants.value = new Map(participants.value).set(participant.identity, {
              ...info,
              muted: false,
            })
        }
      })
  }

  async function connect(opts: { tokenServerUrlValue: string; livekitUrlValue: string; roomId: string }) {
    if (room) {
      appendLog('すでに接続中/接続試行中です')
      return
    }
    tokenServerUrl = opts.tokenServerUrlValue
    livekitUrl = opts.livekitUrlValue
    roomName.value = opts.roomId
    idTokenProviderRoomId = opts.roomId
    manuallyDisconnected = false
    statusKind.value = 'connecting'
    statusMessage.value = null

    try {
      const token = await fetchToken(opts.roomId)
      appendLog('トークン取得成功')

      const newRoom = new Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true } })
      attachRoomListeners(newRoom)
      room = newRoom

      await newRoom.connect(livekitUrl, token)
      appendLog(`ルーム接続完了: room=${opts.roomId}`)
      await newRoom.localParticipant.setMicrophoneEnabled(false)

      applyMetadata(newRoom.metadata)
      syncParticipantsFromRoom(newRoom)

      statusKind.value = 'connected'
      scheduleTokenRefresh()
    } catch (e) {
      appendLog(`接続エラー: ${(e as Error).message}`)
      statusKind.value = 'error'
      statusMessage.value = (e as Error).message
      room = null
    }
  }

  function scheduleTokenRefresh() {
    if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer)
    const refreshInMs = TOKEN_TTL_SECONDS * 0.9 * 1000
    tokenRefreshTimer = setTimeout(async () => {
      if (!room || manuallyDisconnected) return
      appendLog('トークン有効期限が近いため再接続します')
      try {
        const token = await fetchToken(idTokenProviderRoomId)
        await room.disconnect()
        await room.connect(livekitUrl, token)
        await room.localParticipant.setMicrophoneEnabled(false)
        appendLog('トークン更新・再接続に成功しました')
        scheduleTokenRefresh()
      } catch (e) {
        appendLog(`トークン更新エラー: ${(e as Error).message}`)
        statusKind.value = 'error'
        statusMessage.value = 'トークン更新失敗'
      }
    }, refreshInMs)
  }

  async function disconnect() {
    manuallyDisconnected = true
    stopTalkHeartbeat()
    // 自分がロックを保持したまま切断すると、サーバー側はTTL(15秒)経過まで
    // 他の人をブロックし続けてしまうため、ベストエフォートで明示的に解放しておく。
    if (roomName.value) {
      authedFetch(tokenServerUrl, `/rooms/${encodeURIComponent(roomName.value)}/talk/stop`, {
        method: 'POST',
      }).catch(() => {})
    }
    if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer)
      tokenRefreshTimer = null
    }
    if (room) {
      await room.disconnect()
      room = null
    }
    participants.value = new Map()
    isSending.value = false
    currentTalkerUid.value = null
    roomName.value = null
    statusKind.value = 'disconnected'
    statusMessage.value = null
  }

  // ---------- PTT (送話ロック連携) ----------

  function stopTalkHeartbeat() {
    if (talkHeartbeatTimer) {
      clearInterval(talkHeartbeatTimer)
      talkHeartbeatTimer = null
    }
  }

  function startTalkHeartbeat() {
    stopTalkHeartbeat()
    talkHeartbeatTimer = setInterval(async () => {
      if (!roomName.value) return
      try {
        await authedFetch(tokenServerUrl, `/rooms/${encodeURIComponent(roomName.value)}/talk/heartbeat`, {
          method: 'POST',
        })
      } catch (e) {
        // サーバー側で最大発話時間を超えた等、ロックを失った場合はここに来る。
        appendLog(`発話ロックの延長に失敗しました。送話を終了します: ${(e as Error).message}`)
        await stopTalking(true)
      }
    }, TALK_LOCK_HEARTBEAT_MS)
  }

  async function startTalking() {
    if (!room || !roomName.value) return
    pttHeld = true
    const myToken = ++talkRequestToken

    try {
      await authedFetch<TalkStartResponse>(
        tokenServerUrl,
        `/rooms/${encodeURIComponent(roomName.value)}/talk/start`,
        {
          method: 'POST',
        },
      )
    } catch (e) {
      // 他人が発話中(409 talk_locked)など。RoomMetadataChangedでほぼ同時にボタンも
      // 無効化されるはずだが、競合(ほぼ同時押下)によるレースは起こりうるため、ここでも弾く。
      appendLog(`発話を開始できませんでした: ${(e as Error).message}`)
      pttHeld = false
      return
    }

    // [レース対策] talk/start の応答待ちの間にボタンが離されていた場合、ロックは
    // 取得できてしまっているので、使わないままサーバー側に解放を伝える。
    if (!pttHeld || myToken !== talkRequestToken) {
      authedFetch(tokenServerUrl, `/rooms/${encodeURIComponent(roomName.value)}/talk/stop`, {
        method: 'POST',
      }).catch(() => {})
      return
    }

    try {
      await room.localParticipant.setMicrophoneEnabled(true)
      isSending.value = true
      startTalkHeartbeat()
    } catch (e) {
      appendLog(`マイク有効化エラー: ${(e as Error).message}`)
      authedFetch(tokenServerUrl, `/rooms/${encodeURIComponent(roomName.value)}/talk/stop`, {
        method: 'POST',
      }).catch(() => {})
    }
  }

  async function stopTalking(forced = false) {
    pttHeld = false
    talkRequestToken++ // 進行中のstartTalkingがあれば、その結果を無視させる
    if (!room) return
    stopTalkHeartbeat()
    isSending.value = false
    try {
      await room.localParticipant.setMicrophoneEnabled(false)
    } catch (e) {
      appendLog(`マイク無効化エラー: ${(e as Error).message}`)
    }
    if (!forced && roomName.value) {
      authedFetch(tokenServerUrl, `/rooms/${encodeURIComponent(roomName.value)}/talk/stop`, {
        method: 'POST',
      }).catch(() => {})
    }
  }

  return {
    statusKind,
    statusMessage,
    roomName,
    participants,
    logLines,
    isSending,
    currentTalkerUid,
    isConnected,
    pttDisabledFor,
    connect,
    disconnect,
    startTalking,
    stopTalking,
  }
})
