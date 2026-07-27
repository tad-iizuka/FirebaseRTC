/**
 * lib/imageCompression.ts [Phase16]
 *
 * brushup-plan.md「7.3」で確定した「画像はクライアント側で圧縮してから
 * アップロードする(サーバー側では動画/PDFと共通の100MB上限のみチェック)」を
 * 実現する。動画・PDFはこの関数の対象外(そのままアップロードする)。
 *
 * [設計方針] GIFはアニメーションを保持したいことが多く、JPEG化すると
 * アニメーションが壊れてしまうため圧縮対象から除外する(静止画GIFであっても
 * ここでは一律で除外する。将来アニメーションの有無を判定して分岐する余地は
 * 残すが、Phase16の一次実装では単純化する)。
 */

const MAX_BYTES = 1024 * 1024 // 7.3で確定: 1MB
const MAX_DIMENSION = 1920 // 大きすぎる画像は先にダウンスケールしてから品質調整する
const MIN_QUALITY = 0.4

/**
 * 画像ファイルを必要に応じて圧縮する。既に1MB以下、または対象外の形式
 * (GIF等)の場合はそのまま返す。圧縮できなかった場合も元ファイルを返し、
 * 上限チェック自体はサーバー側(lib/attachments.js)に委ねる
 * (クライアント側の圧縮はベストエフォートの最適化であり、必須の関門ではない)。
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file
  }
  if (file.size <= MAX_BYTES) {
    return file
  }

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    let quality = 0.9
    let blob: Blob | null = null
    while (quality >= MIN_QUALITY) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= MAX_BYTES) break
      quality -= 0.15
    }
    if (!blob) return file

    const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'image'
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
  } catch {
    // createImageBitmap/canvas系のAPIが使えない環境等では圧縮を諦め、
    // 元ファイルのまま送る(サーバー側の上限チェックに委ねる)。
    return file
  }
}
