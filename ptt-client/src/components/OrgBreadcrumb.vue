<script setup lang="ts">
// [組織階層内の祖先パンくず表示] GET /rooms/:roomId/org-context の結果を表示する。
//
// [表示切り替え・再訂正] 最下層のノード名は見出し(RoomView.vueのdisplayName)側で
// 表示するようになった(同名の組織が複数階層にまたがる場合、最上位の組織名だけでは
// 区別がつかないため)。そのためここでは「組織名 › 祖先ノード…」という、
// 最下層を除いた祖先経路のみを補助的に表示する(最下層はここでは重複表示しない)。
// breadcrumbが空(Room=組織直下でノード未割り当て)の場合、見出し側がorgNameを
// 表示するため、ここでは何も表示しない(無所属Roomの場合と同じ「無ければ出さない」方針)。
import { computed } from 'vue'
import type { OrgBreadcrumbNode } from '@/types/api'

const props = defineProps<{
  orgName: string | null
  breadcrumb: OrgBreadcrumbNode[]
}>()

// 最下層(見出し側で表示済み)を除いた祖先ノードのみを表示対象にする
const ancestorNodes = computed(() => props.breadcrumb.slice(0, -1))
</script>

<template>
  <div
    v-if="breadcrumb.length > 0 && orgName"
    class="flex flex-wrap items-center gap-1 px-5 pb-1 text-[11px] text-muted-foreground"
  >
    <span>{{ orgName }}</span>
    <template v-for="node in ancestorNodes" :key="node.nodeId">
      <span aria-hidden="true">›</span>
      <span>{{ node.name }}</span>
    </template>
  </div>
</template>
