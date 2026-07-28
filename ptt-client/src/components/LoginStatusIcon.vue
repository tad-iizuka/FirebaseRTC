<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside, onKeyStroke } from '@vueuse/core'
import { User } from '@lucide/vue'

// [ログイン状態アイコン]
// Googleでログインしている場合はFirebase Authのphotoを表示する。
// ゲスト(匿名認証)・未サインインなど、写真を持たない場合は共通のプレースホルダー
// アイコンを表示する。Apple ID(photoURLを提供しない)は現状これと同じ扱いになるが、
// Appleログイン自体への個別対応は今回のスコープ外。
//
// クリックすると簡易メニュー(名前表示＋サインアウト)を開く。旧ヘッダーにあった
// 「ユーザー名 + サインアウト」の常時表示テキストはここに統合した。今後、
// 言語切り替えやプロフィール設定などを追加する場合もこのメニュー内に集約できるよう、
// `menu-items` スロットを用意してある。
const props = defineProps<{
  photoUrl?: string | null
  displayName?: string | null
  isSignedIn: boolean
}>()
const emit = defineEmits<{ signOut: [] }>()

const { t } = useI18n()

const rootRef = ref<HTMLElement | null>(null)
const open = ref(false)

function toggle() {
  open.value = !open.value
}
function close() {
  open.value = false
}

onClickOutside(rootRef, close)
onKeyStroke('Escape', close)

// 画像の読み込みに失敗した場合(オフライン・レート制限等)はプレースホルダーへ
// フォールバックする。photoUrlが変わったら再度読み込みを試みる。
const imageFailed = ref(false)
watch(
  () => props.photoUrl,
  () => {
    imageFailed.value = false
  },
)

const showImage = computed(() => !!props.photoUrl && !imageFailed.value)

const label = computed(() =>
  showImage.value
    ? t('common.loggedInAs', { name: props.displayName || '' })
    : t('common.notLoggedIn'),
)

function handleSignOut() {
  close()
  emit('signOut')
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="flex h-7 w-7 shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:bg-white/10"
      :title="label"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <img
        v-if="showImage"
        :src="photoUrl ?? undefined"
        alt=""
        class="h-full w-full object-cover"
        referrerpolicy="no-referrer"
        @error="imageFailed = true"
      />
      <User v-else class="h-3.5 w-3.5" aria-hidden="true" :stroke-width="2" />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 top-full z-50 mt-2 w-48 rounded-md border border-border bg-card p-1.5 text-xs shadow-lg"
    >
      <template v-if="isSignedIn">
        <div class="flex items-center gap-2 px-2 py-1.5">
          <div class="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground">
            <img v-if="showImage" :src="photoUrl ?? undefined" alt="" class="h-full w-full object-cover" referrerpolicy="no-referrer" />
            <User v-else class="h-3 w-3" aria-hidden="true" :stroke-width="2" />
          </div>
          <span class="truncate">{{ displayName || t('room.nicknameUnset') }}</span>
        </div>

        <div class="my-1 border-t border-border" />

        <!-- 今後の追加メニュー項目用スロット(言語切り替え・プロフィール設定など) -->
        <slot name="menu-items" />

        <button
          type="button"
          role="menuitem"
          class="w-full rounded-sm px-2 py-1.5 text-left text-destructive transition-colors hover:bg-destructive/10"
          @click="handleSignOut"
        >
          {{ t('header.signOut') }}
        </button>
      </template>
      <template v-else>
        <p class="px-2 py-1.5 text-muted-foreground">{{ t('common.notLoggedIn') }}</p>
      </template>
    </div>
  </div>
</template>
