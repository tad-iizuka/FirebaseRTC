<script setup lang="ts">
import { cn } from '@/lib/utils'

interface Props {
  class?: string
}
const props = defineProps<Props>()
const model = defineModel<string>()
</script>

<template>
  <input
    v-model="model"
    :class="
      cn(
        'flex h-10 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  />
</template>
