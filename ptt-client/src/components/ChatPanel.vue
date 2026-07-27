<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatMessage } from '@/types/api'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'

const { t } = useI18n()
const props = defineProps<{
  messages: ChatMessage[]
  myUid?: string | null
  errorMessage?: string | null
  // [Phase16] 添付ファイルの短期署名付きURL発行。呼び出し元(RoomView.vue)が
  // baseUrl/roomIdを束縛した関数を渡す(topBadgesと同様、propとして注入する設計)。
  getAttachmentUrl: (messageId: string) => Promise<string>
  getThumbnailUrl: (messageId: string) => Promise<string>
}>()
const emit = defineEmits<{ send: [text: string]; sendFile: [file: File] }>()

const draft = ref('')

function send() {
  const text = draft.value.trim()
  if (!text) return
  emit('send', text)
  draft.value = ''
}

// [Phase16] サムネイルは表示のたびに1回だけ発行し、messageIdをキーに保持する
// (ChatPanel自体はStale/Freshの判断をせず、chat.tsのキャッシュに委ねる)。
const thumbSrcByMessageId = ref<Record<string, string>>({})

watch(
  () => props.messages,
  (msgs) => {
    for (const m of msgs) {
      if (m.attachment?.thumbnailPath && !thumbSrcByMessageId.value[m.id]) {
        props
          .getThumbnailUrl(m.id)
          .then((url) => {
            thumbSrcByMessageId.value = { ...thumbSrcByMessageId.value, [m.id]: url }
          })
          .catch(() => {
            // 失敗時は汎用アイコン表示のままにする(errorMessageは送受信本体のみに使う)
          })
      }
    }
  },
  { immediate: true },
)

async function openAttachment(messageId: string) {
  try {
    const url = await props.getAttachmentUrl(messageId)
    window.open(url, '_blank', 'noopener')
  } catch {
    // エラーはerrorMessage経由で表示される想定(chat.ts側のfetchDownloadUrlは投げるのみ)
  }
}

const fileInputRef = ref<HTMLInputElement | null>(null)
// [Phase16] 選択直後には送信せず、送信ボタンが押されるまで保持しておくファイル
const pendingFile = ref<File | null>(null)

function pickFile() {
  fileInputRef.value?.click()
}

function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) pendingFile.value = file
  input.value = '' // 同じファイルを連続選択しても change イベントが発火するように
}

function sendPendingFile() {
  if (!pendingFile.value) return
  emit('sendFile', pendingFile.value)
  pendingFile.value = null
}

function cancelPendingFile() {
  pendingFile.value = null
}
</script>

<template>
  <div class="border-t border-border px-5 py-4">
    <div class="mb-2 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{{ t('chat.title') }}</div>
    <div class="mb-2.5 grid max-h-44 gap-1.5 overflow-y-auto text-xs">
      <div
        v-for="m in messages"
        :key="m.id"
        :class="['whitespace-pre-wrap break-words', m.uid === myUid && 'text-live']"
      >
        <span class="text-muted-foreground">[{{ m.createdAt?.toLocaleTimeString() ?? '' }}]</span>
        {{ m.displayName }}: {{ m.text }}

        <div v-if="m.attachment" class="mt-1">
          <button
            v-if="m.attachment.kind === 'image'"
            type="button"
            class="block cursor-pointer border-0 bg-transparent p-0"
            :aria-label="t('chat.attachmentOpen')"
            @click="openAttachment(m.id)"
          >
            <img
              v-if="thumbSrcByMessageId[m.id]"
              :src="thumbSrcByMessageId[m.id]"
              :alt="m.attachment.fileName"
              class="max-h-32 rounded-sm border border-border"
            />
            <span v-else class="text-[11px] text-muted-foreground">[{{ t('chat.attachmentLoading') }}]</span>
          </button>

          <button
            v-else
            type="button"
            class="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-white/5"
            @click="openAttachment(m.id)"
          >
            <span>{{ m.attachment.kind === 'video' ? '🎬' : '📄' }}</span>
            <span class="max-w-40 truncate">{{ m.attachment.fileName }}</span>
          </button>
        </div>
      </div>
    </div>
    <p v-if="errorMessage" class="mb-2 text-[11px] text-destructive">{{ errorMessage }}</p>

    <div
      v-if="pendingFile"
      class="mb-2 flex items-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-[11px]"
    >
      <span>📎</span>
      <span class="max-w-40 flex-1 truncate text-muted-foreground">{{ pendingFile.name }}</span>
      <Button size="sm" class="w-auto px-3" @click="sendPendingFile">{{ t('chat.attachmentSend') }}</Button>
      <Button size="sm" variant="ghost" class="w-auto px-2.5" @click="cancelPendingFile">
        {{ t('chat.attachmentCancel') }}
      </Button>
    </div>

    <div class="flex gap-1.5">
      <input
        ref="fileInputRef"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf"
        class="hidden"
        @change="onFileSelected"
      />
      <Button
        size="sm"
        variant="ghost"
        class="w-auto px-2.5"
        :aria-label="t('chat.attachmentPick')"
        @click="pickFile"
      >
        📎
      </Button>
      <Input v-model="draft" :placeholder="t('chat.placeholder')" maxlength="2000" @keydown.enter="send" />
      <Button size="sm" class="w-auto px-4" @click="send">{{ t('chat.send') }}</Button>
    </div>
  </div>
</template>
