<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ParticipantInfo } from '@/stores/connection'
import type { AssignedBadge, GrantableBadge } from '@/types/api'
import Badge from '@/components/ui/Badge.vue'

const { t } = useI18n()
const props = defineProps<{
  participants: ParticipantInfo[]
  canBan: boolean
  // [Phase13] uid -> 最優先1件のバッジ。取得中/未取得のuidはundefinedになりうる。
  topBadges: Record<string, AssignedBadge | null>
  // [2026-08-04] uid -> 現在付与されている全バッジ(剥奪ボタンの表示用)。
  // Guestの役割バッジ(source: 'guest-role')は剥奪操作の対象外のため、
  // テンプレート側でsource==='grant'のもののみ表示する。
  allBadges: Record<string, AssignedBadge[]>
  // [2026-08-04] Room owner向けの付与できるバッジの選択肢。ownerでない
  // 場合はnullが渡り、その場合は付与/剥奪UI自体を出さない
  // (stores/badges.ts参照。サーバー側がowner以外にはnullを返す)。
  grantableBadges: GrantableBadge[] | null
  isGrantingBadge: boolean
}>()
const emit = defineEmits<{
  ban: [participant: ParticipantInfo]
  report: [participant: ParticipantInfo]
  grantBadge: [participant: ParticipantInfo, badgeId: string]
  revokeBadge: [participant: ParticipantInfo, badgeId: string]
}>()

// uidごとの選択中バッジ(<select>のv-model用)。
const selectedBadgeId = ref<Record<string, string>>({})

function grantableFor(uid: string) {
  // 既に付与済みのバッジは選択肢から外す(grantBadge APIが409を返す
  // だけの空振りリクエストを避けるため)。
  const owned = new Set((props.allBadges[uid] ?? []).map((b) => b.badgeId))
  return (props.grantableBadges ?? []).filter((b) => !owned.has(b.badgeId))
}
</script>

<template>
  <div class="border-t border-border px-5 py-4">
    <div class="mb-2 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{{ t('participants.title') }}</div>
    <div class="flex min-h-[22px] flex-wrap gap-1.5">
      <Badge v-if="participants.length === 0">{{ t('participants.none') }}</Badge>
      <Badge v-for="p in participants" :key="p.identity" :variant="p.muted ? 'default' : 'live'">
        <span v-if="topBadges[p.identity]" :title="topBadges[p.identity]!.name" :aria-label="topBadges[p.identity]!.name" role="img">{{ topBadges[p.identity]!.icon }}</span>
        <span>{{ p.name }}</span>
        <button type="button" class="opacity-70 underline hover:opacity-100" @click="emit('report', p)">
          {{ t('participants.report') }}
        </button>
        <button
          v-if="canBan"
          type="button"
          class="text-destructive opacity-70 underline hover:opacity-100"
          @click="emit('ban', p)"
        >
          {{ t('participants.ban') }}
        </button>
      </Badge>
    </div>

    <!-- [2026-08-04] Room owner向けバッジ付与/剥奪。grantableBadgesが
         nullの間(=ownerでない、または未取得)は何も出さない。 -->
    <div v-if="grantableBadges !== null && participants.length > 0" class="mt-3 grid gap-2">
      <div class="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{{ t('participants.badgeManageTitle') }}</div>
      <div v-for="p in participants" :key="`badge-manage-${p.identity}`" class="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span class="min-w-[6em] truncate text-muted-foreground">{{ p.name }}</span>

        <span
          v-for="b in (allBadges[p.identity] ?? []).filter((x) => x.source === 'grant')"
          :key="`assigned-${p.identity}-${b.badgeId}`"
          class="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5"
        >
          <span role="img" :aria-label="b.name">{{ b.icon }}</span>{{ b.name }}
          <button
            type="button"
            class="text-destructive underline hover:opacity-80"
            :disabled="isGrantingBadge"
            @click="emit('revokeBadge', p, b.badgeId)"
          >
            {{ t('participants.badgeRevoke') }}
          </button>
        </span>

        <template v-if="grantableFor(p.identity).length > 0">
          <select
            v-model="selectedBadgeId[p.identity]"
            class="h-6 rounded-sm border border-input bg-background px-1 text-[11px] text-foreground outline-none focus:border-primary"
          >
            <option value="" disabled>{{ t('participants.badgeSelectPlaceholder') }}</option>
            <option v-for="b in grantableFor(p.identity)" :key="b.badgeId" :value="b.badgeId">{{ b.icon }} {{ b.name }}</option>
          </select>
          <button
            type="button"
            class="underline hover:opacity-80 disabled:opacity-50"
            :disabled="isGrantingBadge || !selectedBadgeId[p.identity]"
            @click="emit('grantBadge', p, selectedBadgeId[p.identity]); selectedBadgeId[p.identity] = ''"
          >
            {{ t('participants.badgeGrant') }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
