<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatMessage } from '@/types/api'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'

const { t } = useI18n()
defineProps<{
  messages: ChatMessage[]
  myUid?: string | null
  errorMessage?: string | null
}>()
const emit = defineEmits<{ send: [text: string] }>()

const draft = ref('')

function send() {
  const text = draft.value.trim()
  if (!text) return
  emit('send', text)
  draft.value = ''
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
      </div>
    </div>
    <p v-if="errorMessage" class="mb-2 text-[11px] text-destructive">{{ errorMessage }}</p>
    <div class="flex gap-1.5">
      <Input v-model="draft" :placeholder="t('chat.placeholder')" maxlength="2000" @keydown.enter="send" />
      <Button size="sm" class="w-auto px-4" @click="send">{{ t('chat.send') }}</Button>
    </div>
  </div>
</template>
