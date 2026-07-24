<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useAdminRoomsStore } from '@/stores/adminRooms'
import { useAdminRecordingsStore } from '@/stores/adminRecordings'
import { usePolling } from '@/composables/usePolling'
import { formatTime } from '@/lib/format'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'

const route = useRoute()
const router = useRouter()
const settings = useSettingsStore()
const rooms = useAdminRoomsStore()
const recordings = useAdminRecordingsStore()

const roomId = computed(() => String(route.params.roomId))

function load() {
  rooms.fetchRoomDetail(settings.tokenServerUrl, roomId.value).catch(() => {})
  // [Phase8] 録音履歴。GET /rooms/:roomId/recordings はメンバーであれば
  // 誰でも閲覧可(admin権限とは別モデル)。
  recordings.fetchRecordings(settings.tokenServerUrl, roomId.value).catch(() => {})
}

onMounted(load)
watch(roomId, load)
// [Phase8] 詳細・録音履歴とも10秒ごとに再取得する。
usePolling(load)

onUnmounted(() => {
  recordings.clear()
})

function back() {
  rooms.clearDetail()
  recordings.clear()
  router.push({ name: 'rooms' })
}

/**
 * [Phase8] owner/moderator限定のGCS署名付きダウンロードURL(5分間有効)を
 * 発行してもらい、新しいタブで開く。一覧取得のエラー(recordings.errorMessage)
 * とは別に、発行操作自体の失敗もここに反映する。
 */
async function download(recordingId: string) {
  try {
    const url = await recordings.issueDownloadUrl(settings.tokenServerUrl, roomId.value, recordingId)
    window.open(url, '_blank')
  } catch (e) {
    recordings.errorMessage = (e as Error).message
  }
}

/**
 * 録音削除。取り消せない操作のため確認ダイアログを挟む。
 */
async function remove(recordingId: string) {
  if (!window.confirm('この録音を削除します。この操作は取り消せません。よろしいですか?')) {
    return
  }
  try {
    await recordings.deleteRecording(settings.tokenServerUrl, roomId.value, recordingId)
  } catch {
    // errorMessageはstore側で設定済み
  }
}
</script>

<template>
  <div class="p-5">
    <Button variant="secondary" size="sm" class="mb-4 w-auto" @click="back">← 一覧に戻る</Button>

    <p v-if="rooms.isForbidden" class="text-xs text-destructive">管理者権限がありません。</p>
    <p v-else-if="rooms.errorMessage" class="text-xs text-destructive">
      詳細の取得に失敗しました: {{ rooms.errorMessage }}
    </p>
    <p
      v-else-if="rooms.isLoadingDetail && !rooms.detail"
      class="text-xs text-muted-foreground"
    >
      読み込み中...
    </p>

    <template v-if="rooms.detail">
      <h2 class="mb-1 text-sm font-semibold">room: {{ rooms.detail.roomId }}</h2>
      <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span>owner={{ rooms.detail.ownerUid }}</span>
        <span>作成={{ formatTime(rooms.detail.createdAt) }}</span>
        <span>定員={{ rooms.detail.maxMembers ?? '—' }}</span>
        <Badge v-if="rooms.detail.recording.active" variant="destructive">録音中</Badge>
        <Badge v-if="rooms.detail.talkLock" variant="accent">発話中: {{ rooms.detail.talkLock.uid }}</Badge>
      </div>

      <h3 class="mb-2 text-[12px] font-medium">メンバー台帳(Firestore)</h3>
      <table class="mb-6 w-full border-collapse text-xs">
        <thead>
          <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <th class="p-2 text-left">UID</th>
            <th class="p-2 text-left">表示名</th>
            <th class="p-2 text-left">role</th>
            <th class="p-2 text-left">status</th>
            <th class="p-2 text-left">参加日時</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in rooms.detail.members" :key="m.uid" class="border-b border-border">
            <td class="max-w-[10rem] truncate p-2">{{ m.uid }}</td>
            <td class="p-2">{{ m.displayName }}</td>
            <td class="p-2">{{ m.role }}</td>
            <td class="p-2">
              <span :class="m.status === 'banned' ? 'text-destructive' : ''">{{ m.status }}</span>
            </td>
            <td class="whitespace-nowrap p-2">{{ formatTime(m.joinedAt) }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="mb-2 text-[12px] font-medium">現在の接続(LiveKit)</h3>
      <table class="mb-6 w-full border-collapse text-xs">
        <thead>
          <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <th class="p-2 text-left">identity</th>
            <th class="p-2 text-left">接続日時</th>
            <th class="p-2 text-left">状態</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rooms.detail.liveParticipants.length === 0">
            <td colspan="3" class="p-2 text-muted-foreground">— 現在接続なし —</td>
          </tr>
          <tr v-for="p in rooms.detail.liveParticipants" :key="p.identity" class="border-b border-border">
            <td class="max-w-[10rem] truncate p-2">{{ p.identity }}</td>
            <td class="whitespace-nowrap p-2">{{ formatTime(p.joinedAt) }}</td>
            <td class="p-2">{{ p.isPublishingAudio ? '送話中' : '—' }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="mb-2 text-[12px] font-medium">録音履歴</h3>
      <p v-if="recordings.errorMessage" class="mb-2 text-xs text-destructive">{{ recordings.errorMessage }}</p>
      <p
        v-else-if="recordings.isLoading && recordings.recordings.length === 0"
        class="mb-2 text-xs text-muted-foreground"
      >
        読み込み中...
      </p>
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr class="border-b border-border text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
            <th class="p-2 text-left">egressId</th>
            <th class="p-2 text-left">開始</th>
            <th class="p-2 text-left">終了</th>
            <th class="p-2 text-left">状態</th>
            <th class="p-2 text-left"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="recordings.recordings.length === 0">
            <td colspan="5" class="p-2 text-muted-foreground">— 録音履歴なし —</td>
          </tr>
          <tr v-for="r in recordings.recordings" :key="r.recordingId" class="border-b border-border">
            <td class="max-w-[10rem] truncate p-2">{{ r.recordingId }}</td>
            <td class="whitespace-nowrap p-2">{{ formatTime(r.startedAt) }}</td>
            <td class="whitespace-nowrap p-2">{{ formatTime(r.endedAt) }}</td>
            <td class="p-2">{{ r.status }}</td>
            <td class="p-2">
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="text-[11px] text-primary underline-offset-2 hover:underline"
                  @click="download(r.recordingId)"
                >
                  ダウンロードURL発行
                </button>
                <button
                  type="button"
                  class="text-[11px] text-destructive underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-40"
                  :disabled="recordings.deletingIds.has(r.recordingId)"
                  @click="remove(r.recordingId)"
                >
                  {{ recordings.deletingIds.has(r.recordingId) ? '削除中...' : '削除' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
