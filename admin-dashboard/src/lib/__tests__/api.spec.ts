import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'

describe('ApiError', () => {
  it('carries statusCode and optional code through', () => {
    const err = new ApiError(403, '管理者権限がありません', undefined)
    expect(err.statusCode).toBe(403)
    expect(err.message).toBe('管理者権限がありません')
  })

  it('is distinguishable from a generic Error via instanceof', () => {
    const err: unknown = new ApiError(500, 'boom')
    expect(err instanceof ApiError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })
})
