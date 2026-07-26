<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useRoomStore } from '@/stores/room'
import { useSavedRoomsStore, type SavedRoom } from '@/stores/savedRooms'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import InviteBox from '@/components/InviteBox.vue'
import SavedRoomsList from '@/components/SavedRoomsList.vue'

const { t } = useI18n()
const router = useRouter()
const settings = useSettingsStore()
const auth = useAuthStore()
const roomStore = useRoomStore()
const savedRooms = useSavedRoomsStore()

const joinRoomId = ref('')
const joinInviteCode = ref('')

async function handleCreateRoom() {
  roomStore.clearError()
  try {
    const data = await roomStore.createRoom(settings.tokenServerUrl)
    savedRooms.upsert(data.roomId, t('roomSelect.createdRoomLabel'), data.inviteCode)
    router.push({ name: 'room', params: { roomId: data.roomId } })
  } catch {
    // roomStore.errorMessage に理由がセットされているのでUIには既に反映済み
  }
}

async function handleJoinRoom() {
  const roomId = joinRoomId.value.trim()
  const inviteCode = joinInviteCode.value.trim()
  if (!roomId || !inviteCode) return
  roomStore.clearError()
  try {
    await roomStore.joinRoom(settings.tokenServerUrl, roomId, inviteCode)
    savedRooms.upsert(roomId, t('roomSelect.joinedRoomLabel'), inviteCode)
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
<!--
    [Phase12・十五訂] ここは isAnonymous(Firebase Auth) で判定する。
    未入室(=どのRoomのmembersドキュメントも持たない)画面のため、
    role(Room内の役割)という概念自体がまだ存在しない。role による
    Guest判定はRoomView.vue側(入室後)で行っており、この2つは統一すべき
    同一軸ではなく意図的に異なるスコープ(brushup-plan.md Phase12参照)。
    -->
    <template v-if="!auth.currentUser?.isAnonymous">
      <Button :disabled="roomStore.isWorking" @click="handleCreateRoom">
        {{ roomStore.isWorking ? t('roomSelect.creating') : t('roomSelect.createRoom') }}
      </Button>

      <div class="text-center text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {{ t('common.orDivider') }}
      </div>
    </template>
    <p v-else class="text-[11px] text-muted-foreground">{{ t('roomSelect.guestCannotCreate') }}</p>

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
