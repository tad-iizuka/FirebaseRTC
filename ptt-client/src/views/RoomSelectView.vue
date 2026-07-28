<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useRoomStore } from '@/stores/room'
import { useSavedRoomsStore, type SavedRoom } from '@/stores/savedRooms'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import InviteBox from '@/components/InviteBox.vue'
import SavedRoomsList from '@/components/SavedRoomsList.vue'

// [ルーム作成のadmin-dashboard移管]
// 以前はここに「新しいルームを作成する」ボタン(owner以外はグレーアウト、
// Guestはそもそも非表示)があったが、ルーム作成はadmin-dashboard専用の
// POST /admin/rooms(rooms:create権限)に一本化した。ptt-clientは常に
// 既存ルームへの参加(招待コードでのjoin)のみを行う画面になっている
// (brushup-plan.md参照)。これにより、isAnonymous(Guest)によるボタン
// 出し分けも不要になった。

const { t } = useI18n()
const router = useRouter()
const settings = useSettingsStore()
const roomStore = useRoomStore()
const savedRooms = useSavedRoomsStore()

const joinRoomId = ref('')
const joinInviteCode = ref('')

async function handleJoinRoom() {
  const roomId = joinRoomId.value.trim()
  const inviteCode = joinInviteCode.value.trim()
  if (!roomId || !inviteCode) return
  roomStore.clearError()
  try {
    await roomStore.joinRoom(settings.tokenServerUrl, roomId, inviteCode)
    // ルーム名が取得できていればそれを履歴の表示ラベルに使い、
    // 未設定の場合のみ従来通りの汎用ラベルにフォールバックする。
    savedRooms.upsert(roomId, roomStore.currentRoomName ?? t('roomSelect.joinedRoomLabel'), inviteCode)
    router.push({ name: 'room', params: { roomId } })
  } catch {
    // roomStore.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}

function openSavedRoom(saved: SavedRoom) {
  roomStore.reenter(saved.roomId, saved.inviteCode)
  router.push({ name: 'room', params: { roomId: saved.roomId } })
}
</script>

<template>
  <div class="grid gap-3.5 p-3.5">
    <p class="text-[11px] text-muted-foreground">{{ t('roomSelect.joinOnlyHint') }}</p>

    <div class="grid grid-cols-2 gap-2.5">
      <div class="grid gap-1">
        <label class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{{
          t('roomSelect.roomIdLabel')
        }}</label>
        <Input v-model="joinRoomId" :placeholder="t('roomSelect.roomIdPlaceholder')" />
      </div>
      <div class="grid gap-1">
        <label class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{{
          t('roomSelect.inviteCodeLabel')
        }}</label>
        <Input v-model="joinInviteCode" :placeholder="t('roomSelect.inviteCodePlaceholder')" />
      </div>
    </div>
    <Button variant="secondary" :disabled="roomStore.isWorking" @click="handleJoinRoom">
      {{ roomStore.isWorking ? t('roomSelect.joining') : t('roomSelect.joinRoom') }}
    </Button>

    <p v-if="roomStore.errorMessage" class="text-[11px] text-destructive">{{ roomStore.errorMessage }}</p>

    <InviteBox :invite-code="roomStore.currentInviteCode" :room-id="roomStore.currentRoomId" />

    <SavedRoomsList :rooms="savedRooms.rooms" @open="openSavedRoom" @remove="savedRooms.remove" />
  </div>
</template>
