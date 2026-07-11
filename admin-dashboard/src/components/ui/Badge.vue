<script lang="ts">
import { type VariantProps, cva } from 'class-variance-authority'

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-mono transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border text-muted-foreground',
        live: 'border-live text-live',
        destructive: 'border-destructive text-destructive',
        accent: 'border-primary text-primary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type BadgeVariants = VariantProps<typeof badgeVariants>
</script>

<script setup lang="ts">
import { cn } from '@/lib/utils'

interface Props {
  variant?: BadgeVariants['variant']
  class?: string
}
const props = defineProps<Props>()
</script>

<template>
  <span :class="cn(badgeVariants({ variant }), props.class)">
    <slot />
  </span>
</template>
