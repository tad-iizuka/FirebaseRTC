// [PWA] Service Worker — App Shell（HTML/CSS/JS/アイコン等の静的アセット）のみを
// キャッシュ対象とする。Firestore・LiveKit・token-server(Cloud Run)への通信は
// いずれも別オリジン（firestore.googleapis.com / LiveKit Cloud / *.run.app）であり、
// 下記の「同一オリジンのGETのみ介入する」というフィルタにより自然に対象外となる。
// 録音状態・BAN状態・チャット等のリアルタイムデータを古いキャッシュで見せてしまう事故を
// 避けるため、意図的にこれらをキャッシュしない（brushup-plan.md Phase16「PWA化」参照）。
//
// Web Push通知は今回のスコープ外。Phase14（プッシュ通知）着手時に、この
// Service Worker基盤（登録・更新・キャッシュ管理の仕組み）を再利用する形で
// pushイベントリスナーを追加する想定。

const SHELL_CACHE_VERSION = 'v1'
const SHELL_CACHE_NAME = `ptt-client-shell-${SHELL_CACHE_VERSION}`

// ビルド時にファイル名がハッシュ化されるJS/CSSは事前一覧化できないため、
// installでは「パスが安定している最小限のシェル」のみを先読みし、
// ハッシュ付きアセットは初回リクエスト時にfetchイベント側で遅延キャッシュする。
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
]

// キャッシュ対象とする静的アセットのdestination。
// 'document'（ナビゲーション）は別扱いのためここには含めない。
const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest'])

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE_NAME)
      // 1つのURLの取得に失敗しても他の先読みを止めないよう個別にcatchする
      await Promise.all(
        PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined)),
      )
    })(),
  )
  // 新しいService Workerを即座にactivateへ進める（更新の反映を早める）。
  // 実際にページ側で新バージョンを使うかどうかはclients.claim()と
  // 各タブのリロードタイミングに依存する。
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 旧バージョンのApp Shellキャッシュを破棄する
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith('ptt-client-shell-') && name !== SHELL_CACHE_NAME)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // GET以外（POST等）は素通しする。token-serverへのAPI呼び出しはほぼPOST/PATCHのため
  // ここでも重ねて除外されるが、主目的は下記の同一オリジン判定。
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 同一オリジン以外（Firestore/Firebase Auth/LiveKit/token-server(Cloud Run)等）には
  // 一切介入しない。event.respondWith()を呼ばなければブラウザ標準の挙動
  // （常にネットワークへ、キャッシュもしない）のままになる。
  if (url.origin !== self.location.origin) return

  // ナビゲーション（画面の直接読み込み・リロード）はネットワーク優先。
  // オフライン時のみキャッシュ済みのApp Shellへフォールバックする。
  // ただしFirestore/LiveKit/token-serverへの接続自体はオフラインでは行えないため、
  // このフォールバックは「白画面ではなく最低限のUIの殻を出す」ためのものであり、
  // オフラインでのルーム参加・送話を保証するものではない。
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const cache = await caches.open(SHELL_CACHE_NAME)
          cache.put('/', response.clone())
          return response
        } catch {
          const cache = await caches.open(SHELL_CACHE_NAME)
          const cached = await cache.match('/')
          return cached ?? Response.error()
        }
      })(),
    )
    return
  }

  // 静的アセット（JS/CSS/画像/フォント/manifest）はstale-while-revalidate。
  // キャッシュがあればまず即座に返しつつ、裏でネットワークから取得し直して更新する。
  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE_NAME)
        const cached = await cache.match(request)
        const networkFetch = fetch(request)
          .then((response) => {
            // opaque(cross-origin no-cors)応答やエラー応答はキャッシュしない
            if (response.ok) cache.put(request, response.clone())
            return response
          })
          .catch(() => undefined)
        return cached ?? (await networkFetch) ?? Response.error()
      })(),
    )
    return
  }

  // 上記いずれにも該当しない同一オリジンGET（想定外のもの）はキャッシュせず素通しする
})
