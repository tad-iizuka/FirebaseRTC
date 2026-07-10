<script setup lang="ts">
defineProps<{ lines: string[] }>()
</script>

<template>
  <div
    class="max-h-32 overflow-y-auto border-t border-border px-5 py-2.5 text-[10px] leading-relaxed text-muted-foreground"
  >
    <div v-for="(line, i) in lines" :key="i" class="whitespace-pre-wrap break-all">{{ line }}</div>
  </div>
</template>
