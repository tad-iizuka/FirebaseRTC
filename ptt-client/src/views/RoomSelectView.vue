<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useRoomStore } from '@/stores/room'
import { useSavedRoomsStore, type SavedRoom } from '@/stores/savedRooms'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import InviteBox from '@/components/InviteBox.vue'
import SavedRoomsList from '@/components/SavedRoomsList.vue'
import QrScannerDialog from '@/components/QrScannerDialog.vue'
import { consumePendingJoin, type ParsedInvite } from '@/lib/inviteLink'

// [ルーム作成のadmin-dashboard移管]
// 以前はここに「新しいルームを作成する」ボタン(owner以外はグレーアウト、
// Guestはそもそも非表示)があったが、ルーム作成はadmin-dashboard専用の
// POST /admin/rooms(rooms:create権限)に一本化した。ptt-clientは常に
// 既存ルームへの参加(招待コードでのjoin)のみを行う画面になっている
// (brushup-plan.md参照)。これにより、isAnonymous(Guest)によるボタン
// 出し分けも不要になった。
//
// [案内文言の削除・2026-08-05] 上記の移管に伴い追加していた
// 「ルームの作成は管理者が行います。招待コードを受け取ったら、下記から
// 参加してください。」という案内文言(roomSelect.joinOnlyHint)は、
// iOS版ContentView.swift(`a9694c8`、モバイルUI再編)で削除されている
// ことがユーザーからの指摘・スクリーンショットで判明したため、Web版でも
// 削除した(画面構成自体で「参加のみ」であることが自明になったための整理と
// 判断。iOS側コミットのコメントでも本文言がWeb版roomSelect.joinOnlyHintと
// 同一である旨が明記されていた)。ロケールキー自体(`ja.json`/`en.json`の
// `roomSelect.joinOnlyHint`)も参照箇所が無くなったため削除した。

const { t } = useI18n()
const router = useRouter()
const settings = useSettingsStore()
const roomStore = useRoomStore()
const savedRooms = useSavedRoomsStore()

const joinRoomId = ref('')
const joinInviteCode = ref('')
const isScannerOpen = ref(false)

// [招待リンク/QR対応] RedirectJoinView('/r')が一時保存したRoom ID・招待コードを
// ここで入力欄へ反映するだけで、自動参加はしない(deeplink-qr-join-plan.md参照)。
// このビューはサインイン後にのみマウントされる(App.vueのAuthView/RouterView分岐)ため、
// 未サインインでリンクを開いた場合もサインイン完了後にここで拾える。
onMounted(() => {
  const pending = consumePendingJoin()
  if (pending) applyParsedInvite(pending)
})

function applyParsedInvite(invite: ParsedInvite) {
  joinRoomId.value = invite.roomId
  joinInviteCode.value = invite.inviteCode
  roomStore.clearError()
}

function handleScanned(invite: ParsedInvite) {
  isScannerOpen.value = false
  applyParsedInvite(invite)
}

async function handleJoinRoom() {
  const roomId = joinRoomId.value.trim()
  const inviteCode = joinInviteCode.value.trim()
  if (!roomId || !inviteCode) return
  roomStore.clearError()
  try {
    await roomStore.joinRoom(settings.tokenServerUrl, roomId, inviteCode)
    // [表示仕様・2026-08-06] ルーム名未設定時の汎用ラベルへのフォールバックは廃止。
    // 未設定の場合はnameをnullのまま保存し、一覧側(SavedRoomsList.vue)で
    // roomIdを表示する。開始/終了時刻も履歴に保存しておき、一覧の下段に出す。
    savedRooms.upsert(roomId, roomStore.currentRoomName, inviteCode, roomStore.schedule)
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
    <div class="grid grid-cols-2 gap-2.5">
      <Button variant="secondary" :disabled="roomStore.isWorking" @click="handleJoinRoom">
        {{ roomStore.isWorking ? t('roomSelect.joining') : t('roomSelect.joinRoom') }}
      </Button>
      <Button variant="ghost" type="button" @click="isScannerOpen = true">
        {{ t('inviteLink.scanButton') }}
      </Button>
    </div>

    <p v-if="roomStore.errorMessage" class="text-[11px] text-destructive">{{ roomStore.errorMessage }}</p>

    <InviteBox :invite-code="roomStore.currentInviteCode" :room-id="roomStore.currentRoomId" />

    <SavedRoomsList :rooms="savedRooms.rooms" @open="openSavedRoom" @remove="savedRooms.remove" />

    <QrScannerDialog :open="isScannerOpen" @close="isScannerOpen = false" @decoded="handleScanned" />
  </div>
</template>
