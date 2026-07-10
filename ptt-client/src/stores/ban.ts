import { defineStore } from 'pinia'
import { ref } from 'vue'
import { type Unsubscribe, doc, getDoc, onSnapshot } from 'firebase/firestore'
import { firestoreDb } from '@/lib/firebase'
import { authedFetch } from '@/lib/api'
import type { BanResponse, RoomMember } from '@/types/api'

// [BAN対応]
// - 自分の rooms/{roomId}/members/{uid} ドキュメントを読み、role(owner/moderator/member)を
//   取得する。BANボタンの表示可否に使う。
// - 同じドキュメントをリアルタイム監視し、statusが'banned'になった瞬間を検知する。
//   BAN自体の強制力はLiveKit側の即時キック(サーバー)が担うが、UI側でも
//   「排除されました」と即座に表示するための補助。
// - BAN実行はowner/moderatorのみサーバー側で許可される。クライアント側のrole表示は
//   あくまでUI制御であり、実際の権限チェックはサーバーが行う。
// firestore.rules により、クライアントは自分自身の members/{uid} ドキュメントしか
// 読み取れない(他人のロールやメンバー一覧は取得できない)。

export const useBanStore = defineStore('ban', () => {
  const myRole = ref<RoomMember['role'] | null>(null)
  const isBanned = ref(false)
  const errorMessage = ref<string | null>(null)

  let unsubscribe: Unsubscribe | null = null

  async function start(roomId: string, uid: string) {
    stop()
    if (!uid) return

    const ref_ = doc(firestoreDb, 'rooms', roomId, 'members', uid)

    try {
      const snap = await getDoc(ref_)
      myRole.value = snap.exists() ? ((snap.data().role as RoomMember['role']) ?? 'member') : null
    } catch (e) {
      errorMessage.value = `ロール取得エラー: ${(e as Error).message}`
      myRole.value = null
    }

    unsubscribe = onSnapshot(
      ref_,
      (snap) => {
        if (snap.exists() && snap.data().status === 'banned') {
          isBanned.value = true
        }
      },
      (e) => {
        errorMessage.value = `BAN監視エラー: ${e.message}`
      },
    )
  }

  function stop() {
    unsubscribe?.()
    unsubscribe = null
    myRole.value = null
    isBanned.value = false
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

  return { myRole, isBanned, errorMessage, start, stop, banParticipant }
})
