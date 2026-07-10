<script setup lang="ts">
defineProps<{
  inviteCode: string | null
  roomId: string | null
}>()
</script>

<template>
  <div
    v-if="inviteCode && roomId"
    class="mx-5 my-3 grid gap-1.5 rounded-sm border border-dashed border-primary bg-background p-2.5 text-[13px]"
  >
    <span>このルームの招待コード(参加者に共有してください):</span>
    <span class="text-lg tracking-[0.15em] text-primary">{{ inviteCode }}</span>
    <span>ルームID: {{ roomId }}</span>
  </div>
</template>
