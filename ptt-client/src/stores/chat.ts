import { defineStore } from 'pinia'
import { ref } from 'vue'
import { type Unsubscribe, collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { firestoreDb } from '@/lib/firebase'
import { authedFetch } from '@/lib/api'
import { compressImageIfNeeded } from '@/lib/imageCompression'
import { i18n } from '@/i18n'
import type {
  AttachmentDownloadUrlResponse,
  AttachmentUploadUrlResponse,
  ChatMessage,
  ChatMessageDoc,
  ChatSendResponse,
} from '@/types/api'

const { t } = i18n.global

// [Phase5] テキストチャット。
// 書き込みはtoken-server(/rooms/:roomId/messages)経由のみ。配信・履歴表示は
// Firestoreのリアルタイムリスナーに任せる(BAN即時反映と同じ設計パターン)。
// LiveKitのData Channelは使わない(モデレーション・履歴配信・BAN時の読み取り遮断が
// できないため)。BANされてstatusが'banned'になった瞬間、firestore.rules側で
// 読み取り権限自体を失う。
//
// [Phase16] 画像/動画/PDFの添付。アップロードはtoken-serverを経由せず、
// 署名付きURLへ直接PUTする(sendAttachment参照)。閲覧用の署名付きURLは
// 有効期限が短い(5分)ため、messageIdをキーにメモリ内キャッシュして
// 期限が近づくまで再発行しない(getAttachmentUrl/getThumbnailUrl参照)。

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
              role: data.role,
              photoUrl: data.photoUrl,
              text: data.text,
              createdAt: data.createdAt?.toDate() ?? null,
              attachment: data.attachment,
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
    attachmentUrlCache.clear()
    thumbnailUrlCache.clear()
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

  /**
   * [Phase16] 画像/動画/PDFを添付してメッセージを送信する。
   *   1. 画像なら圧縮(compressImageIfNeeded、動画/PDFはそのまま)
   *   2. アップロードURLを発行してもらう
   *   3. そのURLへ直接PUT(token-serverを経由しない)
   *   4. POST /messages で確定する(ここでサーバー側がGCS実体を検証する)
   */
  async function sendAttachment(baseUrl: string, roomId: string, file: File, text = '') {
    try {
      const uploadFile = await compressImageIfNeeded(file)

      const uploadUrlData = await authedFetch<AttachmentUploadUrlResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/attachments/upload-url`,
        {
          method: 'POST',
          body: { contentType: uploadFile.type, fileName: uploadFile.name, size: uploadFile.size },
        },
      )

      const putRes = await fetch(uploadUrlData.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': uploadFile.type },
        body: uploadFile,
      })
      if (!putRes.ok) {
        throw new Error(t('errors.chatAttachmentUploadFailed'))
      }

      await authedFetch<ChatSendResponse>(baseUrl, `/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: 'POST',
        body: {
          text: text.trim(),
          attachment: { storagePath: uploadUrlData.storagePath, fileName: uploadFile.name },
        },
      })
    } catch (e) {
      errorMessage.value = (e as Error).message
      throw e
    }
  }

  // [Phase16] 署名付き閲覧URLのメモリ内キャッシュ(messageIdをキーとする)。
  // サーバーの有効期限(5分)より前に、期限が近づいたら再発行する。
  interface CachedUrl {
    url: string
    expiresAt: number
  }
  const attachmentUrlCache = new Map<string, CachedUrl>()
  const thumbnailUrlCache = new Map<string, CachedUrl>()
  const REFRESH_MARGIN_MS = 10 * 1000

  async function fetchDownloadUrl(
    cache: Map<string, CachedUrl>,
    baseUrl: string,
    roomId: string,
    messageId: string,
    suffix: 'attachment-url' | 'thumbnail-url',
  ): Promise<string> {
    const cached = cache.get(messageId)
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return cached.url
    }
    const data = await authedFetch<AttachmentDownloadUrlResponse>(
      baseUrl,
      `/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/${suffix}`,
    )
    cache.set(messageId, { url: data.url, expiresAt: Date.now() + data.expiresInMs })
    return data.url
  }

  function getAttachmentUrl(baseUrl: string, roomId: string, messageId: string) {
    return fetchDownloadUrl(attachmentUrlCache, baseUrl, roomId, messageId, 'attachment-url')
  }

  function getThumbnailUrl(baseUrl: string, roomId: string, messageId: string) {
    return fetchDownloadUrl(thumbnailUrlCache, baseUrl, roomId, messageId, 'thumbnail-url')
  }

  return {
    messages,
    errorMessage,
    start,
    stop,
    sendMessage,
    sendAttachment,
    getAttachmentUrl,
    getThumbnailUrl,
  }
})
