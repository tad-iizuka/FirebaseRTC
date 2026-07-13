<script setup lang="ts">
import { computed, ref } from 'vue'
import { Radio, DoorOpen, Mic, MessageSquare } from '@lucide/vue'
import Button from '@/components/ui/Button.vue'

// [オンボーディング]
// 初回起動時にアプリの使い方を紹介するスワイプ形式の紹介画面。
// App.vue から onboarding.hasCompletedOnboarding が false の間だけ表示され、
// 最後まで進める/スキップするといずれも 'complete' を emit してストアに書き込む。
// PttButton.vue と同じく Pointer Events で一本化してスワイプを検出する
// (マウス/タッチ/ペンをまとめて扱えるため)。

const emit = defineEmits<{ complete: [] }>()

interface Slide {
  icon: typeof Radio
  title: string
  description: string
}

const slides: Slide[] = [
  {
    icon: Radio,
    title: 'PTT Client へようこそ',
    description: 'トランシーバーのように、押している間だけ声が届くシンプルな音声チャットです。',
  },
  {
    icon: DoorOpen,
    title: 'ルームを作成・参加',
    description: 'ルームは招待制です。自分でルームを作成するか、招待コードを受け取って参加しましょう。',
  },
  {
    icon: Mic,
    title: 'ボタンを押して話す',
    description:
      '中央のPTTボタンを押している間だけ音声が送信されます。誰かが話している間は自動的に送話が待機状態になります。',
  },
  {
    icon: MessageSquare,
    title: 'チャットと参加者管理',
    description: 'テキストチャットや参加者一覧に加え、モデレーター向けのBAN・通報機能も使えます。',
  },
]

const index = ref(0)
const isFirst = computed(() => index.value === 0)
const isLast = computed(() => index.value === slides.length - 1)
const current = computed(() => slides[index.value])

function next() {
  if (isLast.value) {
    emit('complete')
    return
  }
  index.value += 1
}

function back() {
  if (!isFirst.value) index.value -= 1
}

function goTo(i: number) {
  index.value = i
}

let pointerStartX = 0
let pointerActive = false
const SWIPE_THRESHOLD_PX = 40

function onPointerDown(e: PointerEvent) {
  pointerStartX = e.clientX
  pointerActive = true
}

function onPointerUp(e: PointerEvent) {
  if (!pointerActive) return
  pointerActive = false
  const dx = e.clientX - pointerStartX
  if (dx <= -SWIPE_THRESHOLD_PX) next()
  else if (dx >= SWIPE_THRESHOLD_PX) back()
}

function onPointerCancel() {
  pointerActive = false
}
</script>

<template>
  <div class="flex min-h-[480px] flex-col">
    <div class="flex justify-end p-3.5">
      <button
        type="button"
        class="text-[11px] uppercase tracking-[0.1em] text-muted-foreground underline-offset-2 hover:underline"
        @click="emit('complete')"
      >
        スキップ
      </button>
    </div>

    <div
      class="flex flex-1 select-none touch-pan-y flex-col items-center justify-center gap-6 px-8 pb-4 text-center"
      @pointerdown="onPointerDown"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <component :is="current.icon" class="h-14 w-14 text-primary" :stroke-width="1.5" />
      <h2 class="text-base font-semibold">{{ current.title }}</h2>
      <p class="max-w-xs text-sm leading-relaxed text-muted-foreground">{{ current.description }}</p>
    </div>

    <div class="flex items-center justify-center gap-2 pb-4">
      <button
        v-for="(_, i) in slides"
        :key="i"
        type="button"
        :aria-label="`スライド ${i + 1}`"
        class="h-1.5 rounded-full transition-all"
        :class="i === index ? 'w-5 bg-primary' : 'w-1.5 bg-border'"
        @click="goTo(i)"
      />
    </div>

    <div class="flex items-center justify-between gap-3 p-5 pt-2">
      <Button variant="secondary" class="w-auto" :disabled="isFirst" @click="back"> 戻る </Button>
      <Button class="w-auto flex-1" @click="next">
        {{ isLast ? 'はじめる' : '次へ' }}
      </Button>
    </div>
  </div>
</template>
