<script setup lang="ts">
// [組織階層のパンくず表示] GET /rooms/:roomId/org-context の結果を表示する。
//
// 無所属Room(orgId===null)は正式な状態として扱う(admin-dashboardが
// 強制バックフィルを行わない設計、brushup-plan.md参照)ため、その場合は
// 何も表示しない(currentRoomNameのv-ifと同じ「無ければ出さない」方針)。
import type { OrgBreadcrumbNode } from '@/types/api'

defineProps<{
  orgName: string | null
  breadcrumb: OrgBreadcrumbNode[]
}>()
</script>

<template>
  <div
    v-if="orgName"
    class="flex flex-wrap items-center gap-1 px-5 pb-1 text-[11px] text-muted-foreground"
  >
    <span>{{ orgName }}</span>
    <template v-for="node in breadcrumb" :key="node.nodeId">
      <span aria-hidden="true">›</span>
      <span>{{ node.name }}</span>
    </template>
  </div>
</template>
