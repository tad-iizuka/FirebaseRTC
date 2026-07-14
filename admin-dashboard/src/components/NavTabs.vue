<script setup lang="ts">
import { useRoute } from 'vue-router'

// [Phase8] 監査ログ・管理者権限タブの追加に伴い、ルーム一覧/詳細のみだった
// 画面にナビゲーションを追加する。ルーム詳細画面(room-detail)にいる間も
// 「ルーム」タブをアクティブ表示する。

const route = useRoute()

function isActive(name: string): boolean {
  if (name === 'rooms') return route.name === 'rooms' || route.name === 'room-detail'
  return route.name === name
}

const tabClass = (name: string) => [
  'rounded-t-sm border border-b-0 px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] transition-colors',
  isActive(name)
    ? 'border-border bg-card text-foreground'
    : 'border-transparent text-muted-foreground hover:text-foreground',
]
</script>

<template>
  <nav class="flex gap-1 border-b border-border px-5 pt-3">
    <RouterLink :to="{ name: 'rooms' }" :class="tabClass('rooms')">ルーム</RouterLink>
    <RouterLink :to="{ name: 'audit-logs' }" :class="tabClass('audit-logs')">監査ログ</RouterLink>
    <RouterLink :to="{ name: 'admins' }" :class="tabClass('admins')">管理者権限</RouterLink>
  </nav>
</template>
