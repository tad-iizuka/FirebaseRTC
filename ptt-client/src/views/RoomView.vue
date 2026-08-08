<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
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
import GuestStatusBar from '@/components/GuestStatusBar.vue'
import OrgBreadcrumb from '@/components/OrgBreadcrumb.vue'
import PttButton from '@/components/PttButton.vue'
import PttMiniBar from '@/components/PttMiniBar.vue'
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
// [開始/終了時刻]
const isWaitingBeforeStart = computed(() => roomStore.scheduleState === 'before_start')
const isChatOnlyAfterEnd = computed(() => roomStore.scheduleState === 'after_end')
const waitingStartTimeLabel = computed(() => {
  const start = roomStore.schedule?.start
  if (!start) return null
  return new Date(start).toLocaleString()
})
const lockedByName = computed(() => {
  const uid = connection.currentTalkerUid
  if (!uid || uid === auth.currentUser?.uid) return null
  return connection.participants.get(uid)?.name ?? uid
})
const participantList = computed(() => Array.from(connection.participants.values()))

// [五十九訂: Web版レイアウト刷新]
// 768px未満(Mobile幅)でのみ使うタブ状態。768px以上(Desktop/Tablet幅)では
// 3ペイン構成となり全て常時表示されるため参照しない(表示切り替えはCSS側の
// `md:`ブレークポイントで行う。テンプレート側コメント参照)。PTTStore等の
// 送話ロジックには一切影響しない、純粋な表示状態。
type MobileTab = 'call' | 'participants' | 'chat'
const activeMobileTab = ref<MobileTab>('call')
// 終了時刻超過(after_end)で「通話」タブの中身(PTTボタン)が無くなった場合、
// 選択中タブが「通話」のままだと空欄になってしまうため「チャット」へ逃がす。
watchEffect(() => {
  if (isChatOnlyAfterEnd.value && activeMobileTab.value === 'call') {
    activeMobileTab.value = 'chat'
  }
})
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
  // [開始/終了時刻] LiveKit接続(connection.connect)より前に、現在の状態を
  // 取得し直す。/join 直後の遷移ならこの呼び出しは冗長だが、保存済みルームへの
  // 再入室(roomStore.reenter経由)ではこれが唯一の取得手段になる。
  await roomStore.fetchAutoRecording(settings.tokenServerUrl, roomId.value)

  if (roomStore.scheduleState === 'before_start') {
    // 待機画面のみ。LiveKit接続・チャット購読とも行わず、開始時刻に達したかを
    // 一定間隔でポーリングして検知する(startScheduleWaitPolling参照)。
    startScheduleWaitPolling()
    return
  }

  await enterSession()
}

/**
 * [開始/終了時刻] in_session / after_end の場合に実際に入室処理を行う部分。
 * before_startのポーリングが完了した際にも呼ばれる(enter()から分離)。
 */
async function enterSession() {
  await ban.start(roomId.value, auth.currentUser?.uid ?? '')
  // [開始/終了時刻] チャット閲覧はbefore_start以外(in_session・after_end)で
  // 許可される。送信可否(in_sessionのみ)はChatPanelへreadOnlyとして渡し、
  // 実際の拒否はtoken-server側(routes/messages.js)が最終的に担保する。
  chat.start(roomId.value)
  // [パンくず表示] 変化頻度が低いため入室時に1回だけ取得する(badges.startの
  // ようなポーリングはしない。stores/orgContext.ts参照)。
  orgContext.fetchOnce(settings.tokenServerUrl, roomId.value)
  badges.start(settings.tokenServerUrl, roomId.value)

  if (roomStore.scheduleState === 'after_end') {
    // [開始/終了時刻] token.js が in_session 以外ではトークンを発行しないため、
    // ここでLiveKit接続自体を試みない(接続してもエラーになるだけのため)。
    return
  }

  await connection.connect({
    tokenServerUrlValue: settings.tokenServerUrl,
    livekitUrlValue: settings.livekitUrl,
    roomId: roomId.value,
  })
}

// [開始/終了時刻] 待機画面中、開始時刻に達したかどうかをポーリングで検知する。
// Room Metadata経由のリアルタイム反映はLiveKit接続が前提のため、
// LiveKit接続前であるbefore_start中はこの方式に頼る(brushup-plan.md参照)。
const SCHEDULE_WAIT_POLL_INTERVAL_MS = 15000
let scheduleWaitTimer: ReturnType<typeof setInterval> | null = null

function startScheduleWaitPolling() {
  stopScheduleWaitPolling()
  scheduleWaitTimer = setInterval(async () => {
    await roomStore.fetchAutoRecording(settings.tokenServerUrl, roomId.value)
    if (roomStore.scheduleState !== 'before_start') {
      stopScheduleWaitPolling()
      await enterSession()
    }
  }, SCHEDULE_WAIT_POLL_INTERVAL_MS)
}
function stopScheduleWaitPolling() {
  if (scheduleWaitTimer !== null) {
    clearInterval(scheduleWaitTimer)
    scheduleWaitTimer = null
  }
}

async function leaveRoom() {
  stopScheduleWaitPolling()
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
  stopScheduleWaitPolling()
  connection.disconnect()
  chat.stop()
  ban.stop()
  badges.stop()
  orgContext.reset()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <p v-if="banNotice" class="px-5 py-2 text-xs text-destructive">{{ banNotice }}</p>

    <!-- [開始/終了時刻] 待機画面(before_start)。他の要素は一切表示しない
         (5.4方針: チャットも閲覧不可のため何も見せられる情報が無い)。 -->
    <div v-if="isWaitingBeforeStart" class="flex flex-col items-center gap-2 px-5 py-16 text-center">
      <p class="text-[15px] font-semibold">{{ t('room.waitingTitle') }}</p>
      <p class="text-[13px] text-muted-foreground">
        {{
          waitingStartTimeLabel
            ? t('room.waitingBodyWithTime', { time: waitingStartTimeLabel })
            : t('room.waitingBodyNoTime')
        }}
      </p>
      <div class="px-5 pt-6">
        <Button variant="secondary" class="w-full" @click="leaveRoom">{{ t('room.leaveRoom') }}</Button>
      </div>
    </div>

    <template v-else>
    <!-- [五十九訂: Web版レイアウト刷新]
         ここから下、ルーム名〜LEAVE ROOMまでは従来通りの共通ヘッダー領域
         (Mobile/Desktop/Tabletいずれの幅でも同じ内容・同じコンポーネントを使う)。
         ブレークポイントで表示が変わるのは、この下の「メインコンテンツ」
         (参加者一覧・PTT・チャット)からで、768px未満はタブ切り替え+常設PTT
         ミニバー、768px以上は3ペイン同時表示にCSSだけで切り替える。
         コンポーネント自体(PttButton/ParticipantList/ChatPanel)は流用し、
         それぞれ1インスタンスのみ描画してコンテナ側のFlex/Grid・`hidden`の
         付け外しで配置と表示/非表示を切り替える(重複マウントしない)。 -->
    <div class="shrink-0">
      <!-- [見出し・不具合修正] 組織(orgId)に紐づくRoomは最下層のノード名(無ければ組織名)を、
           無所属Roomはルーム名を表示する。いずれも未設定の場合は表示しない。
           接続状態(room=付き)は以前ここでStatusRowとして重複表示していたが、
           AppHeader.vue側で常時ドット+テキスト表示するよう改めたため廃止した
           (iOS版ContentView.swift 6訂の移植。詳細はbrushup-plan.md参照)。 -->
      <h1
        v-if="displayName"
        class="truncate px-5 pb-0 pt-3 text-[15px] font-semibold"
      >
        {{ displayName }}
      </h1>
      <OrgBreadcrumb :org-name="orgContext.orgName" :breadcrumb="orgContext.breadcrumb" />

      <GuestStatusBar
        :is-guest="ban.myRole === 'guest'"
        :display-name="ban.myDisplayName"
        :updating="ban.nicknameUpdating"
        :error-message="ban.nicknameErrorMessage"
        @update-nickname="updateNickname"
      />

      <!-- [開始/終了時刻] 終了時刻超過(after_end)は「チャット閲覧のみ」のため、
           録音バー・PTTボタンごと非表示にする(LiveKit未接続でconnection.*系の値も
           すべて初期値のままのため、表示しても意味がない)。 -->
      <p v-if="isChatOnlyAfterEnd" class="px-5 py-2 text-xs text-muted-foreground">
        {{ t('room.afterEndNotice') }}
      </p>
      <template v-else>
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
      </template>
      <div class="px-5 pb-0 pt-2">
        <Button variant="secondary" class="w-full" @click="leaveRoom">{{ t('room.leaveRoom') }}</Button>
      </div>

      <!-- [Mobile幅(〜767px)専用] talk/participants/chatのタブ。768px以上では
           常に非表示(3ペインが常時表示のためタブ自体が不要)。 -->
      <div class="flex border-b border-t border-border text-[11px] uppercase tracking-[0.08em] md:hidden">
        <button
          type="button"
          class="flex-1 border-b-2 px-2 py-2.5 text-center transition-colors"
          :class="activeMobileTab === 'call' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'"
          @click="activeMobileTab = 'call'"
        >
          {{ t('room.tabCall') }}
        </button>
        <button
          type="button"
          class="flex-1 border-b-2 px-2 py-2.5 text-center transition-colors"
          :class="activeMobileTab === 'participants' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'"
          @click="activeMobileTab = 'participants'"
        >
          {{ t('room.tabParticipants') }}
        </button>
        <button
          type="button"
          class="flex-1 border-b-2 px-2 py-2.5 text-center transition-colors"
          :class="activeMobileTab === 'chat' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'"
          @click="activeMobileTab = 'chat'"
        >
          {{ t('room.tabChat') }}
        </button>
      </div>
    </div>

    <!-- [メインコンテンツ] Mobile: 縦積み(タブで排他表示+下部ミニバー)。
         Desktop/Tablet(768px以上): 横並び3ペイン、全て常時表示。 -->
    <div class="flex min-h-0 flex-1 flex-col md:flex-row md:overflow-hidden">
      <!-- 左ペイン: 参加者一覧(Desktop/Tabletでは常時表示・幅固定240px) -->
      <div
        class="min-h-0 flex-1 overflow-y-auto md:block md:w-[240px] md:shrink-0 md:border-r md:border-border"
        :class="{ hidden: activeMobileTab !== 'participants' }"
      >
        <ParticipantList
          :participants="participantList"
          :can-ban="canBan && !isChatOnlyAfterEnd"
          :top-badges="topBadges"
          :all-badges="allBadges"
          :grantable-badges="badges.grantableBadges"
          :is-granting-badge="badges.isGranting"
          @ban="requestBan"
          @report="reportParticipant"
          @grant-badge="grantBadge"
          @revoke-badge="revokeBadge"
        />
      </div>

      <!-- 中央ペイン: PTT(Desktop/Tabletでは残り幅いっぱい・固定表示) -->
      <div
        class="min-h-0 flex-1 overflow-y-auto md:flex md:w-auto md:flex-1 md:flex-col md:items-center md:justify-center md:gap-3.5 md:overflow-y-auto md:border-r md:border-border"
        :class="{ hidden: activeMobileTab !== 'call' }"
      >
        <div v-if="!isChatOnlyAfterEnd" class="flex flex-col items-center gap-3.5 px-5 pb-6 pt-6 md:py-0">
          <PttButton
            :disabled="pttDisabled"
            :is-sending="connection.isSending"
            :locked-by-name="lockedByName"
            @start="connection.startTalking"
            @stop="() => connection.stopTalking()"
          />
          <p class="text-center text-[11px] text-muted-foreground">{{ t('room.pttHint') }}</p>
        </div>
        <p v-else class="px-5 py-8 text-center text-[13px] text-muted-foreground md:py-0">
          {{ t('room.afterEndNotice') }}
        </p>
      </div>

      <!-- 右ペイン: チャット(Desktop/Tabletでは常時表示・可変幅min320px) -->
      <div
        class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex md:w-[380px] md:min-w-[320px] md:shrink"
        :class="{ hidden: activeMobileTab !== 'chat' }"
      >
        <ChatPanel
          class="flex min-h-0 flex-1 flex-col"
          :messages="chat.messages"
          :my-uid="auth.currentUser?.uid"
          :error-message="chat.errorMessage"
          :read-only="isChatOnlyAfterEnd"
          :get-attachment-url="getChatAttachmentUrl"
          :get-thumbnail-url="getChatThumbnailUrl"
          @send="sendChat"
          @send-file="sendChatFile"
        />
      </div>

      <!-- [Mobile幅専用] 常設PTTミニバー。「参加者」「チャット」タブを
           開いていても送話できるようにするための固定バー(README.mdの
           Phase1「安定性・低遅延」要件に直結するため)。「通話」タブは
           PttButton(大きな円ボタン)が主役のため、ここでは二重表示しない。
           after_end(通話不可)の間も表示しない。 -->
      <PttMiniBar
        v-if="activeMobileTab !== 'call' && !isChatOnlyAfterEnd"
        class="md:hidden"
        :disabled="pttDisabled"
        :is-sending="connection.isSending"
        :locked-by-name="lockedByName"
        @start="connection.startTalking"
        @stop="() => connection.stopTalking()"
      />
    </div>

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
    </template>
  </div>
</template>
