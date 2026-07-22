import { firebaseAuth } from '@/lib/firebase'
import { i18n } from '@/i18n'
import type { ServerErrorResponse } from '@/types/api'

/**
 * token-server が返すエラーレスポンス `{ error, code? }` を保持したまま投げる例外。
 * UI層はこれを捕まえて `error.message` をそのまま(または言い換えて)表示する。
 * Phase7で「エラーメッセージのユーザー向け言い換え」を行う際は、
 * この `code` フィールド(talk_locked / talk_not_held 等)を見て文言を出し分けるとよい。
 */
export class ApiError extends Error {
  readonly statusCode: number
  readonly code?: string

  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

interface AuthedFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
}

/**
 * token-serverへの認証付きリクエスト。
 * 全エンドポイントが Authorization: Bearer <Firebase ID Token> を要求するため
 * (token-server/middleware/requireAuth.js の requireFirebaseAuth)、
 * ここで一元的に付与する。
 */
export async function authedFetch<T>(
  baseUrl: string,
  path: string,
  options: AuthedFetchOptions = {},
): Promise<T> {
  const user = firebaseAuth.currentUser
  if (!user) {
    throw new ApiError(401, i18n.global.t('errors.notSignedIn'))
  }
  const idToken = await user.getIdToken()

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
      Authorization: `Bearer ${idToken}`,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    let payload: ServerErrorResponse | undefined
    try {
      payload = (await res.json()) as ServerErrorResponse
    } catch {
      // JSON以外のエラーレスポンス(ネットワーク層のエラーページ等)は無視する
    }
    throw new ApiError(res.status, payload?.error ?? `HTTP ${res.status}`, payload?.code)
  }

  return (await res.json()) as T
}
