<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'

// [Phase10: Guestロール 5.1]
// 「自分自身がGuestとして参加していること」の表示と、ニックネーム変更を担う。
// 他の参加者がGuestかどうかはクライアントからは判定できない(firestore.rulesにより
// 自分自身のmembersドキュメントしか読めず、かつroleを一般公開するAPIも現状存在しない)。
// そのため、ここでは自分自身の状態のみを扱う。

const { t } = useI18n()

const props = defineProps<{
  isGuest: boolean
  displayName: string | null
  updating: boolean
  errorMessage: string | null
}>()
const emit = defineEmits<{ updateNickname: [displayName: string] }>()

const editing = ref(false)
const draft = ref(props.displayName ?? '')

watch(
  () => props.displayName,
  (name) => {
    if (!editing.value) draft.value = name ?? ''
  },
)

function startEdit() {
  draft.value = props.displayName ?? ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

function submit() {
  const trimmed = draft.value.trim()
  if (!trimmed) return
  emit('updateNickname', trimmed)
  editing.value = false
}
</script>

<template>
  <div v-if="isGuest" class="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5 text-xs">
    <Badge variant="accent">{{ t('room.guestBadge') }}</Badge>

    <template v-if="!editing">
      <span class="text-muted-foreground">{{ displayName || t('room.nicknameUnset') }}</span>
      <button
        type="button"
        class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        @click="startEdit"
      >
        {{ t('room.nicknameEdit') }}
      </button>
    </template>
    <template v-else>
      <Input
        v-model="draft"
        class="h-8 max-w-[10rem] text-xs"
        maxlength="30"
        :placeholder="t('room.nicknamePlaceholder')"
        @keyup.enter="submit"
      />
      <Button size="sm" :disabled="updating" @click="submit">
        {{ updating ? t('room.nicknameSaving') : t('room.nicknameSave') }}
      </Button>
      <button
        type="button"
        class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        @click="cancelEdit"
      >
        {{ t('common.cancel') }}
      </button>
    </template>

    <p v-if="errorMessage" class="w-full text-[11px] text-destructive">{{ errorMessage }}</p>
  </div>
</template>
