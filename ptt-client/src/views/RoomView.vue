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
import Button from '@/components/ui/Button.vue'
import StatusRow from '@/components/StatusRow.vue'
import InviteBox from '@/components/InviteBox.vue'
import PttButton from '@/components/PttButton.vue'
import ParticipantList from '@/components/ParticipantList.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import LogPanel from '@/components/LogPanel.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { authedFetch } from '@/lib/api'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const settings = useSettingsStore()
const roomStore = useRoomStore()
const ban = useBanStore()
const chat = useChatStore()
const connection = useConnectionStore()

const roomId = computed(() => String(route.params.roomId))
const banTarget = ref<ParticipantInfo | null>(null)
const banNotice = ref<string | null>(null)

const canBan = computed(() => ban.myRole === 'owner' || ban.myRole === 'moderator')
const pttDisabled = computed(() => connection.pttDisabledFor(auth.currentUser?.uid))
const lockedByName = computed(() => {
  const uid = connection.currentTalkerUid
  if (!uid || uid === auth.currentUser?.uid) return null
  return connection.participants.get(uid)?.name ?? uid
})
const participantList = computed(() => Array.from(connection.participants.values()))

async function enter() {
  banNotice.value = null
  await ban.start(roomId.value, auth.currentUser?.uid ?? '')
  chat.start(roomId.value)
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

async function sendChat(text: string) {
  try {
    await chat.sendMessage(settings.tokenServerUrl, roomId.value, text)
  } catch {
    // chat.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}

onMounted(enter)
onUnmounted(() => {
  connection.disconnect()
  chat.stop()
  ban.stop()
})
</script>

<template>
  <div>
    <p v-if="banNotice" class="px-5 py-2 text-xs text-destructive">{{ banNotice }}</p>

    <StatusRow :kind="connection.statusKind" :message="connection.statusMessage" :room-id="roomId" />
    <InviteBox :invite-code="roomStore.currentInviteCode" :room-id="roomId" />

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
      @ban="requestBan"
      @report="reportParticipant"
    />

    <ChatPanel
      :messages="chat.messages"
      :my-uid="auth.currentUser?.uid"
      :error-message="chat.errorMessage"
      @send="sendChat"
    />

    <LogPanel :lines="connection.logLines" />

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
