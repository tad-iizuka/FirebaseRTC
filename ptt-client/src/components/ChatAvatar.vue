<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { UserRound } from '@lucide/vue'
import { avatarColorClass, avatarInitial } from '@/lib/avatarColor'
import type { ChatSenderRole } from '@/types/api'

// [チャットUI刷新] 表示の優先順位:
//   1. photoUrl があれば写真(丸型)
//   2. role === 'guest' ならベクターアイコン(顔写真を設定できないため
//      頭文字よりも「ゲストである」ことが一目でわかる表現にする)
//   3. それ以外は頭文字+uidから決定的に生成した色
// プロフィール写真機能は本コンポーネント作成時点では未実装のため、
// 実運用ではしばらく常に2/3のパスを通る。photoUrl側の分岐は
// 将来の機能追加時にこのコンポーネントを変更せずに済むよう先に用意している。
const props = withDefaults(
  defineProps<{
    uid: string
    displayName: string
    role?: ChatSenderRole
    photoUrl?: string | null
    size?: number
  }>(),
  { size: 34, role: undefined, photoUrl: null },
)

const { t } = useI18n()

const isGuest = computed(() => props.role === 'guest')
const initial = computed(() => avatarInitial(props.displayName))
const colorClass = computed(() => avatarColorClass(props.uid))
const sizeStyle = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
</script>

<template>
  <img
    v-if="photoUrl"
    :src="photoUrl"
    :alt="displayName"
    class="shrink-0 select-none rounded-full object-cover"
    :style="sizeStyle"
  />
  <div
    v-else-if="isGuest"
    class="flex shrink-0 select-none items-center justify-center rounded-full bg-warning/15 text-warning"
    :style="sizeStyle"
    :title="t('room.guestBadge')"
    :aria-label="t('room.guestBadge')"
    role="img"
  >
    <UserRound :style="{ width: `${size * 0.55}px`, height: `${size * 0.55}px` }" :stroke-width="2" />
  </div>
  <div
    v-else
    :class="[
      'flex shrink-0 select-none items-center justify-center rounded-full font-medium',
      colorClass,
    ]"
    :style="[sizeStyle, { fontSize: `${size * 0.4}px` }]"
    :aria-label="displayName"
    role="img"
  >
    {{ initial }}
  </div>
</template>
