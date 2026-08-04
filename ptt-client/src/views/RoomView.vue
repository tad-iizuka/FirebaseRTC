<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useRoomStore } from '@/stores/room'
import { useBanStore } from '@/stores/ban'
import { useChatStore } from '@/stores/chat'
import { useConnectionStore, type ParticipantInfo } from '@/stores/connection'
import { useRecordingStore } from '@/stores/recording'
import { useBadgesStore } from '@/stores/badges'
import { useOrgContextStore } from '@/stores/orgContext'
import Button from '@/components/ui/Button.vue'
import StatusRow from '@/components/StatusRow.vue'
import GuestStatusBar from '@/components/GuestStatusBar.vue'
import OrgBreadcrumb from '@/components/OrgBreadcrumb.vue'
import PttButton from '@/components/PttButton.vue'
import RecordingBar from '@/components/RecordingBar.vue'
import ParticipantList from '@/components/ParticipantList.vue'
import ChatPanel from '@/components/ChatPanel.vue'
// [2026-08-04] ログ表示非表示化に伴い一時的に未使用。再表示時にコメントを外す。
// import LogPanel from '@/components/LogPanel.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { authedFetch } from '@/lib/api'
import { canManageRoom } from '@/lib/roomPermissions'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const settings = useSettingsStore()
const roomStore = useRoomStore()
const ban = useBanStore()
const chat = useChatStore()
const connection = useConnectionStore()
const recording = useRecordingStore()
const badges = useBadgesStore()
const orgContext = useOrgContextStore()

const roomId = computed(() => String(route.params.roomId))
const banTarget = ref<ParticipantInfo | null>(null)
const banNotice = ref<string | null>(null)

// [Phase12・十五訂] owner/moderatorの判定は lib/roomPermissions.ts の
// canManageRoom() に集約している。この定数はtoken-server/lib/permissions.js と
// CIで一致を検証しているため、直接 'owner' || 'moderator' と書かない。
const canBan = computed(() => canManageRoom(ban.myRole))
const canControlRecording = computed(() => canManageRoom(ban.myRole))
const pttDisabled = computed(() => connection.pttDisabledFor(auth.currentUser?.uid))
const lockedByName = computed(() => {
  const uid = connection.currentTalkerUid
  if (!uid || uid === auth.currentUser?.uid) return null
  return connection.participants.get(uid)?.name ?? uid
})
const participantList = computed(() => Array.from(connection.participants.values()))
// [組織階層への表示切り替え・再訂正] Roomが組織(orgId)に紐づいている場合、
// 見出し・ヘッダーアイコンの頭文字には「最下層のノード名」を優先して使う。
// 同名の組織が複数の支社・現場を持つ場合、最上位の組織名だけでは区別が
// つかないため(例: 「ACME」より「ACME 現場3」の方が識別に有用)。
// ノード未割り当て(breadcrumbが空、Room=組織直下)の場合は組織名を、
// 無所属Room(orgId===null)の場合は従来通りルーム名を使う。
// OrgBreadcrumb側は最下層を除いた祖先経路(組織名+上位ノード)のみを
// 補助表示する(displayNameが既に最下層を担うため)。
const displayName = computed(() => {
  const { orgName, breadcrumb } = orgContext
  if (breadcrumb.length > 0) return breadcrumb[breadcrumb.length - 1].name
  return orgName ?? roomStore.currentRoomName
})
// [Phase13] badges.byUidは{badges, topBadge}を保持するが、ParticipantList.vue
// はtopBadgeだけを表示に使うため、ここでuid -> topBadgeの形へ変換する。
const topBadges = computed(() =>
  Object.fromEntries(Object.entries(badges.byUid).map(([uid, entry]) => [uid, entry.topBadge])),
)
// [2026-08-04] 剥奪ボタン表示用に、uid -> 現在の全バッジ配列も渡す
// (topBadgesは最優先1件のみのため、2件目以降を剥奪できない)。
const allBadges = computed(() =>
  Object.fromEntries(Object.entries(badges.byUid).map(([uid, entry]) => [uid, entry.badges])),
)

async function enter() {
  banNotice.value = null
  await ban.start(roomId.value, auth.currentUser?.uid ?? '')
  chat.start(roomId.value)
  // [Phase9] /join を経由しない再入室や、入室後に他のowner/moderatorが
  // 設定を変更した場合にも対応できるよう、入室のたびに最新値を取り直す。
  roomStore.fetchAutoRecording(settings.tokenServerUrl, roomId.value)
  // [パンくず表示] 変化頻度が低いため入室時に1回だけ取得する(badges.startの
  // ようなポーリングはしない。stores/orgContext.ts参照)。
  orgContext.fetchOnce(settings.tokenServerUrl, roomId.value)
  badges.start(settings.tokenServerUrl, roomId.value)
  await connection.connect({
    tokenServerUrlValue: settings.tokenServerUrl,
    livekitUrlValue: settings.livekitUrl,
    roomId: roomId.value,
  })
}

async function leaveRoom() {
  await connection.disconnect()
  chat.stop()
  ban.stop()
  badges.stop()
  orgContext.reset()
  roomStore.leave()
  router.push({ name: 'room-select' })
}

// [BAN対応] 自分がBANされたことをリアルタイム検知したら、即座にルームから退出する。
// BAN自体の強制力はLiveKit側の即時キック(サーバー)が担うため、ここは表示のための補助。
watch(
  () => ban.isBanned,
  async (banned) => {
    if (!banned) return
    banNotice.value = t('room.banNotice')
    await leaveRoom()
  },
)

function requestBan(p: ParticipantInfo) {
  banTarget.value = p
}
async function confirmBan() {
  const target = banTarget.value
  banTarget.value = null
  if (!target) return
  try {
    await ban.banParticipant(settings.tokenServerUrl, roomId.value, target.identity)
  } catch {
    // ban.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}

async function reportParticipant(p: ParticipantInfo) {
  const reason = window.prompt(t('room.reportPromptLabel', { name: p.name }), '')
  if (reason === null || !reason.trim()) return
  try {
    await authedFetch(settings.tokenServerUrl, '/reports', {
      method: 'POST',
      body: { roomId: roomId.value, reportedUid: p.identity, reason: reason.trim() },
    })
  } catch (e) {
    connection.logLines.push(t('room.reportError', { message: (e as Error).message }))
  }
}

async function startRecording() {
  try {
    await recording.startRecording(settings.tokenServerUrl, roomId.value)
  } catch {
    // recording.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}
async function stopRecording() {
  try {
    await recording.stopRecording(settings.tokenServerUrl, roomId.value)
  } catch {
    // recording.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}
async function toggleAutoRecording(value: boolean) {
  try {
    await roomStore.setAutoRecording(settings.tokenServerUrl, roomId.value, value)
  } catch {
    // roomStore.autoRecordingErrorMessage に理由がセットされているのでUIには既に反映済み
  }
}

async function sendChat(text: string) {
  try {
    await chat.sendMessage(settings.tokenServerUrl, roomId.value, text)
  } catch {
    // chat.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}

// [Phase16] 添付ファイル送信。ChatPanel.vueからFileを受け取り、圧縮・
// アップロードURL発行・PUT・メッセージ確定までをchat.sendAttachmentに委ねる。
async function sendChatFile(file: File) {
  try {
    await chat.sendAttachment(settings.tokenServerUrl, roomId.value, file)
  } catch {
    // chat.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}

// [Phase16] ChatPanel.vueへ渡す、baseUrl/roomIdを束縛した閲覧URL発行関数。
function getChatAttachmentUrl(messageId: string) {
  return chat.getAttachmentUrl(settings.tokenServerUrl, roomId.value, messageId)
}
function getChatThumbnailUrl(messageId: string) {
  return chat.getThumbnailUrl(settings.tokenServerUrl, roomId.value, messageId)
}

async function updateNickname(displayName: string) {
  try {
    await ban.updateNickname(settings.tokenServerUrl, roomId.value, displayName)
  } catch {
    // ban.nicknameErrorMessage に理由がセットされているのでUIには既に反映済み
  }
}

// [2026-08-04] Room owner向けバッジ付与/剥奪。サーバー側
// (routes/roomBadges.js)がowner判定・grantableByRoomOwnerフラグの両方を
// 検証するため、フロント側はエラーメッセージの表示のみを担う
// (confirmBan等と同じ、catchして store側のエラー表示に任せるパターン)。
async function grantBadge(p: ParticipantInfo, badgeId: string) {
  try {
    await badges.grantBadgeTo(settings.tokenServerUrl, roomId.value, p.identity, badgeId)
  } catch {
    // badges.grantErrorMessage に理由がセットされているのでUIには既に反映済み
  }
}
async function revokeBadge(p: ParticipantInfo, badgeId: string) {
  try {
    await badges.revokeBadgeFrom(settings.tokenServerUrl, roomId.value, p.identity, badgeId)
  } catch {
    // badges.grantErrorMessage に理由がセットされているのでUIには既に反映済み
  }
}

onMounted(enter)
onUnmounted(() => {
  connection.disconnect()
  chat.stop()
  ban.stop()
  badges.stop()
  orgContext.reset()
})
</script>

<template>
  <div>
    <p v-if="banNotice" class="px-5 py-2 text-xs text-destructive">{{ banNotice }}</p>

    <!-- [見出し] 組織(orgId)に紐づくRoomは最下層のノード名(無ければ組織名)を、
         無所属Roomはルーム名を表示する。いずれも未設定の場合は表示しない
         (roomIdはStatusRow側で常に表示されるため、名前は補助的な表示)。 -->
    <h1
      v-if="displayName"
      class="truncate px-5 pb-0 pt-3 text-[15px] font-semibold"
    >
      {{ displayName }}
    </h1>
    <OrgBreadcrumb :org-name="orgContext.orgName" :breadcrumb="orgContext.breadcrumb" />

    <StatusRow :kind="connection.statusKind" :message="connection.statusMessage" :room-id="roomId" />
    <GuestStatusBar
      :is-guest="ban.myRole === 'guest'"
      :display-name="ban.myDisplayName"
      :updating="ban.nicknameUpdating"
      :error-message="ban.nicknameErrorMessage"
      @update-nickname="updateNickname"
    />
    <RecordingBar
      :is-recording="connection.isRecording"
      :started-at="connection.recordingStartedAt"
      :can-control="canControlRecording"
      :starting="recording.starting"
      :stopping="recording.stopping"
      :error-message="recording.errorMessage"
      :auto-recording="roomStore.autoRecording"
      :auto-recording-loading="roomStore.autoRecordingLoading"
      :auto-recording-error-message="roomStore.autoRecordingErrorMessage"
      @start="startRecording"
      @stop="stopRecording"
      @update-auto-recording="toggleAutoRecording"
    />
    <div class="px-5 pb-0 pt-2">
      <Button variant="secondary" class="w-full" @click="leaveRoom">{{ t('room.leaveRoom') }}</Button>
    </div>

    <div class="flex flex-col items-center gap-3.5 px-5 pb-6 pt-6">
      <PttButton
        :disabled="pttDisabled"
        :is-sending="connection.isSending"
        :locked-by-name="lockedByName"
        @start="connection.startTalking"
        @stop="() => connection.stopTalking()"
      />
      <p class="text-center text-[11px] text-muted-foreground">{{ t('room.pttHint') }}</p>
    </div>

    <ParticipantList
      :participants="participantList"
      :can-ban="canBan"
      :top-badges="topBadges"
      :all-badges="allBadges"
      :grantable-badges="badges.grantableBadges"
      :is-granting-badge="badges.isGranting"
      @ban="requestBan"
      @report="reportParticipant"
      @grant-badge="grantBadge"
      @revoke-badge="revokeBadge"
    />

    <ChatPanel
      :messages="chat.messages"
      :my-uid="auth.currentUser?.uid"
      :error-message="chat.errorMessage"
      :get-attachment-url="getChatAttachmentUrl"
      :get-thumbnail-url="getChatThumbnailUrl"
      @send="sendChat"
      @send-file="sendChatFile"
    />

    <!-- [2026-08-04] 開発者向けログ表示(LogPanel)を非表示化。
         ログの収集自体(stores/connection.ts の logLines)は維持しており、表示のみをコメントアウトしている。
         再表示が必要な場合はこの行を戻すこと(iOS ContentView.swift / Android PTTApp.kt と同じ方針)。 -->
    <!-- <LogPanel :lines="connection.logLines" /> -->

    <ConfirmDialog
      :open="!!banTarget"
      :title="t('room.banConfirmTitle')"
      :description="t('room.banConfirmDescription', { name: banTarget?.name ?? '' })"
      :confirm-label="t('room.banConfirmLabel')"
      @confirm="confirmBan"
      @cancel="banTarget = null"
    />
  </div>
</template>
