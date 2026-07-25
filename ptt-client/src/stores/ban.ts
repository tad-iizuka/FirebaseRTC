import { defineStore } from 'pinia'
import { ref } from 'vue'
import { type Unsubscribe, doc, getDoc, onSnapshot } from 'firebase/firestore'
import { firestoreDb } from '@/lib/firebase'
import { authedFetch } from '@/lib/api'
import { i18n } from '@/i18n'
import type { BanResponse, NicknameResponse, RoomMember } from '@/types/api'

const { t } = i18n.global

// [BAN対応]
// - 自分の rooms/{roomId}/members/{uid} ドキュメントを読み、role(owner/moderator/member/guest)を
//   取得する。BANボタンの表示可否に使う。
// - 同じドキュメントをリアルタイム監視し、statusが'banned'になった瞬間を検知する。
//   BAN自体の強制力はLiveKit側の即時キック(サーバー)が担うが、UI側でも
//   「排除されました」と即座に表示するための補助。
// - BAN実行はowner/moderatorのみサーバー側で許可される。クライアント側のrole表示は
//   あくまでUI制御であり、実際の権限チェックはサーバーが行う。
// firestore.rules により、クライアントは自分自身の members/{uid} ドキュメントしか
// 読み取れない(他人のロールやメンバー一覧は取得できない)。
//
// [Phase10: Guestロール 5.1] ニックネーム(displayName)もこの自分自身の
// members/{uid} ドキュメントの一部なので、同じonSnapshot購読に相乗りする形で
// myDisplayNameとして追跡する。他人が変更した場合は関係ないため、
// 「自分のニックネームが他タブ等から変更された場合のリアルタイム反映」用途。

export const useBanStore = defineStore('ban', () => {
  const myRole = ref<RoomMember['role'] | null>(null)
  const myDisplayName = ref<string | null>(null)
  const isBanned = ref(false)
  const errorMessage = ref<string | null>(null)
  const nicknameUpdating = ref(false)
  const nicknameErrorMessage = ref<string | null>(null)

  let unsubscribe: Unsubscribe | null = null

  async function start(roomId: string, uid: string) {
    stop()
    if (!uid) return

    const ref_ = doc(firestoreDb, 'rooms', roomId, 'members', uid)

    try {
      const snap = await getDoc(ref_)
      myRole.value = snap.exists() ? ((snap.data().role as RoomMember['role']) ?? 'member') : null
      myDisplayName.value = snap.exists() ? ((snap.data().displayName as string) ?? null) : null
    } catch (e) {
      errorMessage.value = t('errors.roleFetch', { message: (e as Error).message })
      myRole.value = null
    }

    unsubscribe = onSnapshot(
      ref_,
      (snap) => {
        if (!snap.exists()) return
        if (snap.data().status === 'banned') {
          isBanned.value = true
        }
        myDisplayName.value = (snap.data().displayName as string) ?? null
      },
      (e) => {
        errorMessage.value = t('errors.banWatch', { message: e.message })
      },
    )
  }

  function stop() {
    unsubscribe?.()
    unsubscribe = null
    myRole.value = null
    myDisplayName.value = null
    isBanned.value = false
    nicknameErrorMessage.value = null
  }

  async function banParticipant(baseUrl: string, roomId: string, targetUid: string) {
    try {
      await authedFetch<BanResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(targetUid)}/ban`,
        { method: 'POST' },
      )
      // LiveKit側の即時キックによりParticipantDisconnectedイベントが発火し、
      // connection storeのparticipantsからも自動的に消える
    } catch (e) {
      errorMessage.value = (e as Error).message
      throw e
    }
  }

  /**
   * 自分自身のニックネームを変更する(token-server/routes/rooms.js の
   * PATCH /:roomId/nickname)。反映自体はonSnapshot経由で自動的に届くが、
   * リクエスト成功時点でも楽観的にmyDisplayNameを更新しておく。
   */
  async function updateNickname(baseUrl: string, roomId: string, displayName: string) {
    nicknameErrorMessage.value = null
    nicknameUpdating.value = true
    try {
      const data = await authedFetch<NicknameResponse>(
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/nickname`,
        { method: 'PATCH', body: { displayName } },
      )
      myDisplayName.value = data.displayName
    } catch (e) {
      nicknameErrorMessage.value = (e as Error).message
      throw e
    } finally {
      nicknameUpdating.value = false
    }
  }

  return {
    myRole,
    myDisplayName,
    isBanned,
    errorMessage,
    nicknameUpdating,
    nicknameErrorMessage,
    start,
    stop,
    banParticipant,
    updateNickname,
  }
})
