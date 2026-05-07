import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Wave 3 #2 — getAuditPool's two paths:
//   - AUDIT_DATABASE_URL unset → falls back to getDbPoolOrNull (legacy)
//   - AUDIT_DATABASE_URL set   → returns a dedicated singleton pool
//                                wired through resolveSslConfig

const getDbPoolOrNullMock = vi.fn()
const resolveSslConfigMock = vi.fn().mockReturnValue({ rejectUnauthorized: true })

vi.mock('@/lib/db/pool', () => ({
  getDbPoolOrNull: () => getDbPoolOrNullMock(),
  resolveSslConfig: (...a: unknown[]) => resolveSslConfigMock(...a),
}))

const PoolCtorMock = vi.fn()
const onMock = vi.fn()

vi.mock('pg', () => ({
  Pool: class {
    constructor(opts: unknown) {
      PoolCtorMock(opts)
    }
    on(...a: unknown[]) {
      return onMock(...a)
    }
  },
}))

import { getAuditPool } from '@/lib/audit/pool'

const ORIG_AUDIT_URL = process.env.AUDIT_DATABASE_URL

describe('getAuditPool — Wave 3 #2', () => {
  beforeEach(() => {
    PoolCtorMock.mockReset()
    onMock.mockReset()
    getDbPoolOrNullMock.mockReset()
    resolveSslConfigMock.mockClear()
    ;(global as { __levelchannelAuditPool?: unknown }).__levelchannelAuditPool =
      undefined
    delete process.env.AUDIT_DATABASE_URL
  })

  afterEach(() => {
    if (ORIG_AUDIT_URL !== undefined) {
      process.env.AUDIT_DATABASE_URL = ORIG_AUDIT_URL
    } else {
      delete process.env.AUDIT_DATABASE_URL
    }
    ;(global as { __levelchannelAuditPool?: unknown }).__levelchannelAuditPool =
      undefined
    vi.restoreAllMocks()
  })

  it('falls back to getDbPoolOrNull when AUDIT_DATABASE_URL is unset', () => {
    const sentinel = { fake: 'shared' } as unknown
    getDbPoolOrNullMock.mockReturnValue(sentinel)

    const got = getAuditPool()

    expect(got).toBe(sentinel)
    expect(PoolCtorMock).not.toHaveBeenCalled()
  })

  it('returns null when both AUDIT_DATABASE_URL and DATABASE_URL are unset', () => {
    getDbPoolOrNullMock.mockReturnValue(null)

    expect(getAuditPool()).toBeNull()
    expect(PoolCtorMock).not.toHaveBeenCalled()
  })

  it('builds a dedicated pool with SSL gate when AUDIT_DATABASE_URL is set', () => {
    process.env.AUDIT_DATABASE_URL =
      'postgres://levelchannel_audit_writer:secret@db.example.com:5432/levelchannel'

    const got = getAuditPool()

    expect(got).not.toBeNull()
    expect(PoolCtorMock).toHaveBeenCalledTimes(1)
    const opts = PoolCtorMock.mock.calls[0][0] as Record<string, unknown>
    expect(opts.connectionString).toBe(process.env.AUDIT_DATABASE_URL)
    expect(opts.max).toBe(4)
    expect(opts.ssl).toEqual({ rejectUnauthorized: true })
    expect(resolveSslConfigMock).toHaveBeenCalledWith(
      process.env.AUDIT_DATABASE_URL,
    )
    // Background error handler attached.
    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('reuses the same singleton across calls (no per-call pool creation)', () => {
    process.env.AUDIT_DATABASE_URL =
      'postgres://levelchannel_audit_writer:secret@db.example.com:5432/levelchannel'

    const first = getAuditPool()
    const second = getAuditPool()

    expect(first).toBe(second)
    expect(PoolCtorMock).toHaveBeenCalledTimes(1)
  })

  it('treats an empty/whitespace AUDIT_DATABASE_URL as unset (defensive)', () => {
    process.env.AUDIT_DATABASE_URL = '   '
    const sentinel = { fake: 'shared' } as unknown
    getDbPoolOrNullMock.mockReturnValue(sentinel)

    const got = getAuditPool()

    expect(got).toBe(sentinel)
    expect(PoolCtorMock).not.toHaveBeenCalled()
  })
})
