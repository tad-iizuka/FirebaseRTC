<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, Paperclip, Video } from '@lucide/vue'
import type { ChatMessage } from '@/types/api'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import ChatAvatar from '@/components/ChatAvatar.vue'
import { linkify } from '@/lib/linkify'

const { t } = useI18n()
const props = defineProps<{
  messages: ChatMessage[]
  myUid?: string | null
  errorMessage?: string | null
  // [開始/終了時刻] after_end(終了時刻超過)では閲覧のみ許可し、
  // 送信フォーム自体を表示しない。token-server側もchat:send操作を
  // in_session以外で拒否するため、これは二重の防御(表示上の親切さ)。
  readOnly?: boolean
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

// [IME対応] 日本語入力で漢字変換を確定する際のEnterキーは、ブラウザ上では
// 通常のEnterキー押下と区別がつかない形でkeydownイベントが発火する。
// event.isComposing (変換確定時はtrue) を見て、変換確定のEnterでは送信しない
// ようにする。isComposingを実装していない古いブラウザ向けの保険として、
// keyCode 229(IME処理中を示す値)も合わせて見ておく。
function onEnter(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  send()
}

// [チャットUI刷新] LINE等のトークUIに合わせ、連続する自分の発言はバブルを
// 詰めて表示する。「ヘッダー(アバター+名前)を出すかどうか」を1メッセージずつ
// 判定し、日付が変わった箇所には区切りを挟む。
// - 直前が別ユーザー、または日付区切りの直後 → ヘッダーを出す
// - 直前が同ユーザーでも、一定時間(5分)以上間が空いたら出し直す
//   (「さっきの続き」か「しばらく経ってからまた話しかけた」かを区別するため)
const GROUP_WINDOW_MS = 5 * 60 * 1000

type ChatListItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; showHeader: boolean }

function dateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

const listItems = computed<ChatListItem[]>(() => {
  const items: ChatListItem[] = []
  let prevMessage: ChatMessage | null = null
  let prevDateKey: string | null = null

  for (const m of props.messages) {
    const createdAt = m.createdAt
    const dateKey = createdAt ? createdAt.toDateString() : null

    if (dateKey && dateKey !== prevDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: dateLabel(createdAt as Date) })
      prevMessage = null // 日付が変わったら必ずヘッダーを出し直す
    }

    const sameSenderAsPrev = prevMessage !== null && prevMessage.uid === m.uid
    const withinGroupWindow =
      sameSenderAsPrev &&
      !!prevMessage!.createdAt &&
      !!createdAt &&
      createdAt.getTime() - prevMessage!.createdAt.getTime() < GROUP_WINDOW_MS
    const showHeader = !withinGroupWindow

    items.push({ type: 'message', key: m.id, message: m, showHeader })

    prevMessage = m
    prevDateKey = dateKey ?? prevDateKey
  }

  return items
})

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

    <div class="mb-2.5 grid max-h-60 gap-0.5 overflow-y-auto text-xs">
      <template v-for="item in listItems" :key="item.key">
        <!-- 日付区切り -->
        <div v-if="item.type === 'date'" class="my-1.5 flex items-center justify-center">
          <span class="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-muted-foreground">
            {{ item.label }}
          </span>
        </div>

        <!-- メッセージ行(LINE風: 自分は右寄せ・アバター無し、相手は左寄せ・アバター+名前) -->
        <div
          v-else
          :class="[
            'flex gap-2',
            item.message.uid === myUid ? 'justify-end' : 'items-start',
            item.showHeader ? 'mt-2' : 'mt-0.5',
          ]"
        >
          <!-- 相手側アバター列。連続投稿でヘッダーを出さない行は、位置を揃えるための空スペーサー -->
          <div v-if="item.message.uid !== myUid" class="w-[34px] shrink-0">
            <ChatAvatar
              v-if="item.showHeader"
              :uid="item.message.uid"
              :display-name="item.message.displayName"
              :role="item.message.role"
              :photo-url="item.message.photoUrl"
            />
          </div>

          <div :class="['flex min-w-0 flex-col', item.message.uid === myUid ? 'items-end' : 'items-start']">
            <!-- 相手の名前(自分の発言では名乗る必要が無いため出さない) -->
            <div
              v-if="item.message.uid !== myUid && item.showHeader"
              class="mb-0.5 truncate text-[11px] text-muted-foreground"
            >
              {{ item.message.displayName }}
            </div>

            <div
              :class="[
                'flex max-w-[16rem] items-end gap-1.5',
                item.message.uid === myUid ? 'flex-row-reverse' : 'flex-row',
              ]"
            >
              <!-- テキスト吹き出し(添付のみのメッセージではテキストが空なので出さない) -->
              <div
                v-if="item.message.text"
                :class="[
                  'min-w-0 whitespace-pre-wrap break-words rounded-2xl border px-3 py-1.5 leading-relaxed',
                  item.message.uid === myUid
                    ? 'border-primary/40 bg-primary/15 text-foreground'
                    : 'border-border bg-muted/60 text-foreground',
                ]"
              >
                <template v-for="(seg, i) in linkify(item.message.text)" :key="i">
                  <a
                    v-if="seg.type === 'url'"
                    :href="seg.value"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-live underline underline-offset-2 hover:opacity-80"
                    >{{ seg.value }}</a
                  >
                  <template v-else>{{ seg.value }}</template>
                </template>
              </div>

              <span class="shrink-0 whitespace-nowrap pb-0.5 text-[10px] text-muted-foreground">
                {{ item.message.createdAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '' }}
              </span>
            </div>

            <!-- 添付ファイル -->
            <div v-if="item.message.attachment" class="mt-1">
              <button
                v-if="item.message.attachment.kind === 'image'"
                type="button"
                class="block cursor-pointer overflow-hidden rounded-2xl border border-border bg-muted/60 p-0.5"
                :aria-label="t('chat.attachmentOpen')"
                @click="openAttachment(item.message.id)"
              >
                <img
                  v-if="thumbSrcByMessageId[item.message.id]"
                  :src="thumbSrcByMessageId[item.message.id]"
                  :alt="item.message.attachment.fileName"
                  class="max-h-32 rounded-xl"
                />
                <span v-else class="block px-2 py-1 text-[11px] text-muted-foreground">
                  [{{ t('chat.attachmentLoading') }}]
                </span>
              </button>

              <button
                v-else
                type="button"
                class="flex max-w-[16rem] items-center gap-2 rounded-2xl border border-border bg-muted/60 px-2.5 py-1.5 text-[11px] text-foreground transition-colors hover:bg-muted"
                @click="openAttachment(item.message.id)"
              >
                <Video v-if="item.message.attachment.kind === 'video'" class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" :stroke-width="2" />
                <FileText v-else class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" :stroke-width="2" />
                <span class="min-w-0 truncate">{{ item.message.attachment.fileName }}</span>
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <p v-if="errorMessage" class="mb-2 text-[11px] text-destructive">{{ errorMessage }}</p>

    <div
      v-if="!readOnly && pendingFile"
      class="mb-2 flex items-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-[11px]"
    >
      <Paperclip class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" :stroke-width="2" />
      <span class="max-w-40 flex-1 truncate text-muted-foreground">{{ pendingFile.name }}</span>
      <Button size="sm" class="w-auto px-3" @click="sendPendingFile">{{ t('chat.attachmentSend') }}</Button>
      <Button size="sm" variant="ghost" class="w-auto px-2.5" @click="cancelPendingFile">
        {{ t('chat.attachmentCancel') }}
      </Button>
    </div>

    <input
      v-if="!readOnly"
      ref="fileInputRef"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf"
      class="hidden"
      @change="onFileSelected"
    />
    <p v-if="readOnly" class="text-[11px] text-muted-foreground">{{ t('chat.readOnlyNotice') }}</p>
    <div v-else-if="!pendingFile" class="flex gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        class="w-auto px-2.5"
        :aria-label="t('chat.attachmentPick')"
        @click="pickFile"
      >
        <Paperclip class="h-3.5 w-3.5" aria-hidden="true" :stroke-width="2" />
      </Button>
      <Input v-model="draft" :placeholder="t('chat.placeholder')" maxlength="2000" @keydown.enter="onEnter" />
      <Button size="sm" class="w-auto px-4" @click="send">{{ t('chat.send') }}</Button>
    </div>
  </div>
</template>
