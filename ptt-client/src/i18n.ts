import { createI18n } from 'vue-i18n'
import ja from '@/locales/ja.json'
import en from '@/locales/en.json'

// [多言語化] ブラウザの言語設定(navigator.language)を見て、対応済みのロケールが
// あればそれを初期値にする。未対応言語の場合は日本語(既存の挙動)にフォールバックする。
// 選択言語は明示的な切り替えUIを後で追加しやすいよう localStorage にも永続化する。
export type SupportedLocale = 'ja' | 'en'
const SUPPORTED_LOCALES: SupportedLocale[] = ['ja', 'en']
const STORAGE_KEY = 'ptt.locale'

function detectLocale(): SupportedLocale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && (SUPPORTED_LOCALES as string[]).includes(saved)) {
      return saved as SupportedLocale
    }
  } catch {
    // localStorageが使えない環境ではブラウザ言語判定にフォールバックする
  }
  const browserLang = navigator.language?.slice(0, 2)
  return (SUPPORTED_LOCALES as string[]).includes(browserLang) ? (browserLang as SupportedLocale) : 'ja'
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'ja',
  messages: { ja, en },
})

export function setLocale(locale: SupportedLocale) {
  i18n.global.locale.value = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // ベストエフォート。保存できなくても表示言語自体は切り替わる。
  }
}
