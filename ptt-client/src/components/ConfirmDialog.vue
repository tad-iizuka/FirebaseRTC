<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'

defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel?: string
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    @keydown.esc="emit('cancel')"
  >
    <Card class="w-full max-w-sm p-5">
      <h2 class="mb-2 text-sm font-semibold">{{ title }}</h2>
      <p class="mb-5 whitespace-pre-line text-xs text-muted-foreground">{{ description }}</p>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" size="sm" @click="emit('cancel')">キャンセル</Button>
        <Button variant="destructive" size="sm" @click="emit('confirm')">{{
          confirmLabel ?? '実行する'
        }}</Button>
      </div>
    </Card>
  </div>
</template>
