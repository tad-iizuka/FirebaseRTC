<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useUserDirectoryStore } from '@/stores/userDirectory'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'

// [2026-07-27新設] ユーザー管理画面(一覧・検索)。
//
// [経緯] バッジの付与/剥奪は元々RoomDetailView.vueのメンバー台帳から行って
// いたが、バッジ自体はRoomに紐付かないユーザー単位の概念であり、Room詳細
// 画面から付与するのは不自然というユーザー指摘を受け、この画面に一本化した
// (brushup-plan.md参照)。
//
// [検索キーがメールアドレスである理由] このアプリには「表示名」の
// グローバルな管理がない(ニックネームはRoomごとのFirestore members
// ドキュメントにしか存在しない)。一方Memberは5.2の仕様上メールアドレス
// 必須のため、実質的にメールアドレスが唯一のグローバルな検索キーになる。
// Guest(匿名認証)はメールアドレスを持たないため、一覧には自然に出てこない。

const router = useRouter()
const settings = useSettingsStore()
const store = useUserDirectoryStore()

const emailQuery = ref('')

function search() {
  store.searchUsers(settings.tokenServerUrl, emailQuery.value.trim()).catch(() => {})
}

function loadMore() {
  store.searchUsers(settings.tokenServerUrl, emailQuery.value.trim(), { append: true }).catch(() => {})
}

function openProfile(uid: string) {
  router.push({ name: 'user-detail', params: { uid } })
}

function formatIso(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : '—'
}
</script>

<template>
  <div class="p-5">
    <!-- [2026-08-02追加] 権限がない場合はエラーのみを表示し、検索フォームや
         一覧等は出さない(見えていても叩けば403になるだけのため)。 -->
    <p v-if="store.isForbidden" class="text-xs text-destructive">
      管理者権限がありません。
    </p>
    <template v-else>
      <h2 class="mb-1 text-sm font-semibold">ユーザー</h2>
      <p class="mb-4 text-[11px] text-muted-foreground">
        Firebase Authに登録されているユーザー(メールアドレス認証のMember)をメールアドレスで検索する。
        匿名認証のGuestアカウントはメールアドレスを持たないため一覧には出てこない。
        バッジの付与/剥奪は各ユーザーのプロフィール画面から行う。
      </p>

      <div class="mb-4 flex max-w-md items-center gap-2">
        <Input v-model="emailQuery" placeholder="メールアドレス(部分一致)" @keyup.enter="search" />
        <Button size="sm" class="w-auto" :disabled="store.isLoadingUsers" @click="search">
          {{ store.isLoadingUsers ? '検索中...' : '検索' }}
        </Button>
      </div>

      <p v-if="store.errorMessage" class="text-xs text-destructive">
        ユーザー一覧の取得に失敗しました: {{ store.errorMessage }}
      </p>
      <p
        v-else-if="!store.isLoadingUsers && store.users.length === 0"
        class="text-xs text-muted-foreground"
      >
        — 検索結果なし(メールアドレスの一部を入力して検索してください) —
      </p>

      <div class="grid gap-2">
        <Card
          v-for="u in store.users"
          :key="u.uid"
          class="cursor-pointer p-3 hover:border-primary"
          @click="openProfile(u.uid)"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-medium">{{ u.email }}</span>
            <Badge v-if="u.disabled" variant="destructive">無効化済み</Badge>
          </div>
          <p class="mt-1 text-[11px] text-muted-foreground">
            uid: {{ u.uid }} / 作成: {{ formatIso(u.createdAt) }}
          </p>
        </Card>
      </div>

      <div v-if="store.nextPageToken" class="mt-4">
        <Button size="sm" variant="secondary" class="w-auto" :disabled="store.isLoadingUsers" @click="loadMore">
          {{ store.isLoadingUsers ? '読み込み中...' : 'もっと読み込む' }}
        </Button>
        <!-- [既知の制約] 1リクエストにつきFirebase Authの1ページ(最大1000件)しか
             走査しないため、該当ユーザーが多い場合は複数回「もっと読み込む」が
             必要になることがある(token-server/routes/users.js参照)。 -->
      </div>
    </template>
  </div>
</template>
