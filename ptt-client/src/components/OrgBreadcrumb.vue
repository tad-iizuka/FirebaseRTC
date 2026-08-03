<script setup lang="ts">
// [組織階層内のノードパンくず表示] GET /rooms/:roomId/org-context の結果のうち
// breadcrumb(組織直下からRoomが割り当てられたノードまでの経路)を表示する。
//
// [表示切り替え] 組織名(orgName)自体は見出し(RoomView.vueのdisplayName)側で
// 既に表示されているため、ここで重複表示はしない。組織に紐づいていても
// ノード未割り当て(breadcrumbが空、Room=組織直下)の場合は何も表示しない
// (無所属Room(orgId===null)の場合と同じ「無ければ出さない」方針)。
import type { OrgBreadcrumbNode } from '@/types/api'

defineProps<{
  breadcrumb: OrgBreadcrumbNode[]
}>()
</script>

<template>
  <div
    v-if="breadcrumb.length > 0"
    class="flex flex-wrap items-center gap-1 px-5 pb-1 text-[11px] text-muted-foreground"
  >
    <template v-for="(node, index) in breadcrumb" :key="node.nodeId">
      <span v-if="index > 0" aria-hidden="true">›</span>
      <span>{{ node.name }}</span>
    </template>
  </div>
</template>
