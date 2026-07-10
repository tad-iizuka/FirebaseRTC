<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useRoomStore } from '@/stores/room'
import { useSavedRoomsStore, type SavedRoom } from '@/stores/savedRooms'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import InviteBox from '@/components/InviteBox.vue'
import SavedRoomsList from '@/components/SavedRoomsList.vue'

const router = useRouter()
const settings = useSettingsStore()
const roomStore = useRoomStore()
const savedRooms = useSavedRoomsStore()

const joinRoomId = ref('')
const joinInviteCode = ref('')

async function handleCreateRoom() {
  roomStore.clearError()
  try {
    const data = await roomStore.createRoom(settings.tokenServerUrl)
    savedRooms.upsert(data.roomId, '自分が作成したルーム', data.inviteCode)
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
    savedRooms.upsert(roomId, '招待コードで参加したルーム', inviteCode)
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
    <Button :disabled="roomStore.isWorking" @click="handleCreateRoom">
      {{ roomStore.isWorking ? '作成中...' : '新しいルームを作成する' }}
    </Button>

    <div class="text-center text-[10px] uppercase tracking-[0.1em] text-muted-foreground">— または —</div>

    <div class="grid grid-cols-2 gap-2.5">
      <div class="grid gap-1">
        <label class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">ルームID</label>
        <Input v-model="joinRoomId" placeholder="招待された側が入力" />
      </div>
      <div class="grid gap-1">
        <label class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">招待コード</label>
        <Input v-model="joinInviteCode" placeholder="8文字のコード" />
      </div>
    </div>
    <Button variant="secondary" :disabled="roomStore.isWorking" @click="handleJoinRoom">
      {{ roomStore.isWorking ? '参加中...' : '招待コードで参加する' }}
    </Button>

    <p v-if="roomStore.errorMessage" class="text-[11px] text-destructive">{{ roomStore.errorMessage }}</p>

    <InviteBox :invite-code="roomStore.currentInviteCode" :room-id="roomStore.currentRoomId" />

    <SavedRoomsList :rooms="savedRooms.rooms" @open="openSavedRoom" @remove="savedRooms.remove" />
  </div>
</template>
