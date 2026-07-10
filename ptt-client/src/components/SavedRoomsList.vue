<script setup lang="ts">
import type { SavedRoom } from '@/stores/savedRooms'
import Button from '@/components/ui/Button.vue'

defineProps<{ rooms: SavedRoom[] }>()
const emit = defineEmits<{ open: [room: SavedRoom]; remove: [roomId: string] }>()
</script>

<template>
  <div v-if="rooms.length" class="grid gap-2">
    <span class="text-center text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
      — 最近使ったルーム —
    </span>
    <div v-for="room in rooms" :key="room.roomId" class="flex items-center gap-2">
      <Button variant="secondary" class="flex-1 justify-start normal-case" @click="emit('open', room)">
        {{ room.label }} ({{ room.roomId }})
      </Button>
      <Button variant="secondary" size="sm" @click="emit('remove', room.roomId)">削除</Button>
    </div>
  </div>
</template>
