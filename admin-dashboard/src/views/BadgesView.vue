<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useAdminBadgesStore } from '@/stores/adminBadges'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Badge from '@/components/ui/Badge.vue'
import Card from '@/components/ui/Card.vue'
import type { BadgeCategory, BadgeGrantMethod } from '@/types/admin'
import { cn } from '@/lib/utils'

// [Phase13] バッジ基本機能のPoC管理画面。
// 「5.3 バッジシステム」の通り、団体スコープを持たない全体共通の
// 1マスタを、システム管理者(badges:manage権限保有者)が登録・編集する。
// [2026-07-27] 個々のユーザーへの実際の付与/剥奪は、以前はRoomDetailView.vue
// 側で行っていたが、badgeGrantsがRoomに紐付かないユーザー単位の概念である
// ため、UsersView.vue/UserDetailView.vue(ユーザー管理画面)に一本化した。
// このマスタ画面は「どんなバッジが存在しうるか」の定義のみを扱う。

const settings = useSettingsStore()
const store = useAdminBadgesStore()

function load() {
  store.fetchBadges(settings.tokenServerUrl).catch(() => {})
  store.fetchDisplayConfig(settings.tokenServerUrl)
}
onMounted(load)

// --- 新規作成フォーム ---
const newName = ref('')
const newIcon = ref('')
const newDescription = ref('')
const newCategory = ref<BadgeCategory>('skill')
const newGrantMethod = ref<BadgeGrantMethod>('manual')
const newPriority = ref(10)

const CATEGORY_OPTIONS: { value: BadgeCategory; label: string }[] = [
  { value: 'role', label: '役割章(通常はGuest用の予約枠。手動作成は非推奨)' },
  { value: 'skill', label: '技能章' },
  { value: 'unit', label: '部隊章' },
  { value: 'rank', label: '階級章' },
  { value: 'other', label: 'その他' },
]
const GRANT_METHOD_OPTIONS: { value: BadgeGrantMethod; label: string }[] = [
  { value: 'manual', label: '手動のみ(Room内ownerが付与)' },
  { value: 'auto', label: '自動のみ(バッチ処理。Phase13では条件未実装)' },
  { value: 'both', label: '両方' },
]

async function createBadge() {
  if (!newName.value.trim() || !newIcon.value.trim()) return
  try {
    await store.createBadge(settings.tokenServerUrl, {
      name: newName.value.trim(),
      icon: newIcon.value.trim(),
      description: newDescription.value.trim() || null,
      category: newCategory.value,
      grantMethod: newGrantMethod.value,
      priority: newPriority.value,
    })
    newName.value = ''
    newIcon.value = ''
    newDescription.value = ''
    newCategory.value = 'skill'
    newGrantMethod.value = 'manual'
    newPriority.value = 10
  } catch {
    // saveErrorMessageに反映済み
  }
}

// --- 優先度・廃止フラグの編集(行内編集) ---
const priorityDrafts = ref<Record<string, number>>({})

function priorityDraftFor(badgeId: string, current: number) {
  return priorityDrafts.value[badgeId] ?? current
}

async function savePriority(badgeId: string) {
  const draft = priorityDrafts.value[badgeId]
  if (draft === undefined) return
  try {
    await store.updateBadge(settings.tokenServerUrl, badgeId, { priority: draft })
  } catch {
    // saveErrorMessageに反映済み
  }
}

async function toggleActive(badgeId: string, active: boolean) {
  try {
    await store.updateBadge(settings.tokenServerUrl, badgeId, { active })
  } catch {
    // saveErrorMessageに反映済み
  }
}

// --- 表示設定(maxDisplayCount) ---
const maxDisplayCountDraft = ref<number | null>(null)

async function saveDisplayConfig() {
  if (maxDisplayCountDraft.value == null) return
  try {
    await store.updateDisplayConfig(settings.tokenServerUrl, maxDisplayCountDraft.value)
  } catch {
    // saveErrorMessageに反映済み
  }
}
</script>

<template>
  <div class="p-5">
    <h2 class="mb-1 text-sm font-semibold">バッジマスタ</h2>
    <p class="mb-4 text-[11px] text-muted-foreground">
      団体・業種プロファイル単位のマスタ切り替えはPhase15で対応予定。現時点では全団体共通の1マスタ。
      個々のユーザーへの付与/剥奪は「ユーザー」タブから行う。
    </p>

    <p v-if="store.isForbidden" class="text-xs text-destructive">
      管理者権限がありません(adminUsers/&#123;uid&#125;.permissions に badges:monitor が必要です)。
    </p>
    <p v-else-if="store.errorMessage" class="text-xs text-destructive">
      バッジ一覧の取得に失敗しました: {{ store.errorMessage }}
    </p>

    <h3 class="mb-2 mt-2 text-[12px] font-medium">表示設定</h3>
    <div class="mb-6 flex flex-wrap items-center gap-2">
      <span class="text-xs text-muted-foreground">プロフィール画面の最大表示件数</span>
      <input
        type="number"
        min="1"
        max="20"
        class="h-8 w-20 rounded-sm border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
        :value="maxDisplayCountDraft ?? store.displayConfig?.maxDisplayCount ?? 5"
        @input="maxDisplayCountDraft = Number(($event.target as HTMLInputElement).value)"
      />
      <Button size="sm" class="w-auto" :disabled="store.isSaving" @click="saveDisplayConfig">
        {{ store.isSaving ? '更新中...' : '保存' }}
      </Button>
    </div>

    <h3 class="mb-2 text-[12px] font-medium">バッジ一覧</h3>
    <p v-if="store.isLoadingBadges && store.badges.length === 0" class="mb-3 text-xs text-muted-foreground">
      読み込み中...
    </p>
    <p v-else-if="store.badges.length === 0" class="mb-3 text-xs text-muted-foreground">— バッジなし —</p>

    <div class="mb-6 grid gap-2">
      <Card
        v-for="b in store.badges"
        :key="b.badgeId"
        :class="cn('p-3', !b.active && 'opacity-50')"
      >
        <div class="mb-1 flex flex-wrap items-center gap-2">
          <span class="text-base leading-none">{{ b.icon }}</span>
          <span class="text-xs font-medium">{{ b.name }}</span>
          <Badge>{{ b.category }}</Badge>
          <Badge variant="accent">{{ b.grantMethod }}</Badge>
          <Badge v-if="!b.active" variant="destructive">廃止済み</Badge>
        </div>
        <p v-if="b.description" class="mb-2 text-[11px] text-muted-foreground">{{ b.description }}</p>
        <div class="flex flex-wrap items-center gap-2 text-[11px]">
          <span class="text-muted-foreground">優先度</span>
          <input
            type="number"
            class="h-7 w-16 rounded-sm border border-input bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-primary"
            :value="priorityDraftFor(b.badgeId, b.priority)"
            @input="priorityDrafts[b.badgeId] = Number(($event.target as HTMLInputElement).value)"
          />
          <Button
            size="sm"
            variant="secondary"
            class="h-7 w-auto px-2 text-[11px]"
            :disabled="store.isSaving || priorityDraftFor(b.badgeId, b.priority) === b.priority"
            @click="savePriority(b.badgeId)"
          >
            保存
          </Button>
          <button
            type="button"
            class="text-[11px] underline-offset-2 hover:underline"
            :class="b.active ? 'text-destructive' : 'text-primary'"
            @click="toggleActive(b.badgeId, !b.active)"
          >
            {{ b.active ? '廃止する' : '再度有効化する' }}
          </button>
        </div>
      </Card>
    </div>

    <h3 class="mb-2 text-[12px] font-medium">バッジを新規作成</h3>
    <div class="grid max-w-md gap-2">
      <Input v-model="newName" placeholder="名称(例: 優秀対応賞)" />
      <Input v-model="newIcon" placeholder="アイコン(絵文字。例: 🏅)" />
      <Input v-model="newDescription" placeholder="説明(任意)" />
      <select
        v-model="newCategory"
        class="h-10 rounded-sm border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
      >
        <option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <select
        v-model="newGrantMethod"
        class="h-10 rounded-sm border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
      >
        <option v-for="opt in GRANT_METHOD_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">優先度</span>
        <input
          v-model.number="newPriority"
          type="number"
          class="h-9 w-24 rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
        />
      </div>
      <Button size="sm" class="w-auto" :disabled="store.isSaving" @click="createBadge">
        {{ store.isSaving ? '作成中...' : 'バッジを作成' }}
      </Button>
      <p v-if="store.saveErrorMessage" class="text-xs text-destructive">{{ store.saveErrorMessage }}</p>
    </div>
  </div>
</template>
