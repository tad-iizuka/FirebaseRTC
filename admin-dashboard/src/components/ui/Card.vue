<script setup lang="ts">
import { cn } from '@/lib/utils'

interface Props {
  class?: string
}
const props = defineProps<Props>()
</script>

<template>
  <div :class="cn('rounded-md border border-border bg-card text-card-foreground', props.class)">
    <slot />
  </div>
</template>
