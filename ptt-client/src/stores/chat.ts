import { defineStore } from 'pinia'
import { ref } from 'vue'
import { type Unsubscribe, collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { firestoreDb } from '@/lib/firebase'
import { authedFetch } from '@/lib/api'
import { i18n } from '@/i18n'
import type { ChatMessage, ChatMessageDoc, ChatSendResponse } from '@/types/api'

const { t } = i18n.global

// [Phase5] テキストチャット。
// 書き込みはtoken-server(/rooms/:roomId/messages)経由のみ。配信・履歴表示は
// Firestoreのリアルタイムリスナーに任せる(BAN即時反映と同じ設計パターン)。
// LiveKitのData Channelは使わない(モデレーション・履歴配信・BAN時の読み取り遮断が
// できないため)。BANされてstatusが'banned'になった瞬間、firestore.rules側で
// 読み取り権限自体を失う。

const HISTORY_LIMIT = 200

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const errorMessage = ref<string | null>(null)

  let unsubscribe: Unsubscribe | null = null

  function start(roomId: string) {
    stop()
    const q = query(
      collection(firestoreDb, 'rooms', roomId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(HISTORY_LIMIT),
    )
    unsubscribe = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs
          .map((d) => {
            const data = d.data() as ChatMessageDoc
            return {
              id: d.id,
              uid: data.uid,
              displayName: data.displayName,
              text: data.text,
              createdAt: data.createdAt?.toDate() ?? null,
            } satisfies ChatMessage
          })
          .reverse() // 古い→新しい順に並べ直す
        messages.value = docs
      },
      (e) => {
        errorMessage.value = t('errors.chatFetch', { message: e.message })
      },
    )
  }

  function stop() {
    unsubscribe?.()
    unsubscribe = null
    messages.value = []
  }

  async function sendMessage(baseUrl: string, roomId: string, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      await authedFetch<ChatSendResponse>(baseUrl, `/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: 'POST',
        body: { text: trimmed },
      })
    } catch (e) {
      errorMessage.value = (e as Error).message
      throw e
    }
  }

  return { messages, errorMessage, start, stop, sendMessage }
})
