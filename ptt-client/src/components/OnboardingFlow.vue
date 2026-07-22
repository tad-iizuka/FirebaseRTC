<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Radio, DoorOpen, Mic, MessageSquare } from '@lucide/vue'
import Button from '@/components/ui/Button.vue'

// [オンボーディング]
// 初回起動時にアプリの使い方を紹介するスワイプ形式の紹介画面。
// App.vue から onboarding.hasCompletedOnboarding が false の間だけ表示され、
// 最後まで進める/スキップするといずれも 'complete' を emit してストアに書き込む。
// PttButton.vue と同じく Pointer Events で一本化してスワイプを検出する
// (マウス/タッチ/ペンをまとめて扱えるため)。
//
// [多言語化] スライドの文言(title/description)はロケールファイル
// (src/locales/{ja,en}.json の onboarding.slides)側で管理する。
// アイコンだけは言語に依存しないためこのコンポーネント側で保持し、
// インデックスで対応するロケールの文言と組み合わせる。

const { t, tm } = useI18n()
const emit = defineEmits<{ complete: [] }>()

const icons = [Radio, DoorOpen, Mic, MessageSquare]

interface Slide {
  icon: (typeof icons)[number]
  title: string
  description: string
}

const slides = computed<Slide[]>(() => {
  const localizedSlides = tm('onboarding.slides') as unknown as { title: string; description: string }[]
  return localizedSlides.map((slide, i) => ({ icon: icons[i], ...slide }))
})

const index = ref(0)
const isFirst = computed(() => index.value === 0)
const isLast = computed(() => index.value === slides.value.length - 1)
const current = computed(() => slides.value[index.value])

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
        {{ t('onboarding.skip') }}
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
        :aria-label="t('onboarding.slideLabel', { n: i + 1 })"
        class="h-1.5 rounded-full transition-all"
        :class="i === index ? 'w-5 bg-primary' : 'w-1.5 bg-border'"
        @click="goTo(i)"
      />
    </div>

    <div class="flex items-center justify-between gap-3 p-5 pt-2">
      <Button variant="secondary" class="w-auto" :disabled="isFirst" @click="back">
        {{ t('onboarding.back') }}
      </Button>
      <Button class="w-auto flex-1" @click="next">
        {{ isLast ? t('onboarding.start') : t('onboarding.next') }}
      </Button>
    </div>
  </div>
</template>
