import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mirrors tests/audit/payment-events.test.ts: mock the audit pool,
// observe the recorder's SQL binds, assert best-effort semantics
// (swallow on failure, no-op when pool is null).

const queryMock = vi.fn()
const getAuditPoolMock = vi.fn()

vi.mock('@/lib/audit/pool', () => ({
  getAuditPool: () => getAuditPoolMock(),
}))

vi.mock('@/lib/auth/email-hash', () => ({
  hashEmailForRateLimit: (email: string) => `hash(${email.toLowerCase()})`,
}))

import { recordAuthAuditEvent } from '@/lib/audit/auth-events'

describe('recordAuthAuditEvent', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockResolvedValue({ rowCount: 1 })
    getAuditPoolMock.mockReset()
    getAuditPoolMock.mockReturnValue({ query: queryMock })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts a successful login with hashed email and the seven SQL binds', async () => {
    const ok = await recordAuthAuditEvent({
      eventType: 'auth.login.success',
      accountId: 'acct-uuid',
      email: 'A@B.com',
      clientIp: '203.0.113.42',
      userAgent: 'Mozilla/5.0',
    })

    expect(ok).toBe(true)
    expect(queryMock).toHaveBeenCalledTimes(1)

    const [sql, binds] = queryMock.mock.calls[0]
    expect(sql).toContain('insert into auth_audit_events')
    expect(binds).toEqual([
      'auth.login.success',
      'acct-uuid',
      'hash(a@b.com)',
      '203.0.113.42',
      'Mozilla/5.0',
      JSON.stringify({}),
    ])
  })

  it('records the reason tag in the payload column for a failed login', async () => {
    await recordAuthAuditEvent({
      eventType: 'auth.login.failed',
      accountId: null,
      email: 'unknown@example.com',
      clientIp: '198.51.100.7',
      userAgent: null,
      reason: 'unknown_email',
    })

    const [, binds] = queryMock.mock.calls[0]
    expect(binds[1]).toBeNull()
    expect(JSON.parse(binds[5])).toEqual({ reason: 'unknown_email' })
  })

  it('merges caller-supplied payload with the reason tag', async () => {
    await recordAuthAuditEvent({
      eventType: 'auth.login.failed',
      accountId: null,
      email: 'a@b.com',
      reason: 'wrong_password',
      payload: { attempt: 3 },
    })

    const [, binds] = queryMock.mock.calls[0]
    expect(JSON.parse(binds[5])).toEqual({
      attempt: 3,
      reason: 'wrong_password',
    })
  })

  it('swallows DB errors and returns false (best-effort contract)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    queryMock.mockRejectedValueOnce(new Error('connection refused'))

    const ok = await recordAuthAuditEvent({
      eventType: 'auth.login.success',
      accountId: 'acct-uuid',
      email: 'a@b.com',
    })

    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('silently no-ops when DATABASE_URL is unset (pool returns null)', async () => {
    getAuditPoolMock.mockReturnValueOnce(null)

    const ok = await recordAuthAuditEvent({
      eventType: 'auth.login.success',
      accountId: 'acct-uuid',
      email: 'a@b.com',
    })

    expect(ok).toBe(false)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('always routes the email through hashEmailForRateLimit (no raw email bound)', async () => {
    await recordAuthAuditEvent({
      eventType: 'auth.login.failed',
      accountId: null,
      email: 'Leak-Me@example.com',
      reason: 'wrong_password',
    })

    const [, binds] = queryMock.mock.calls[0]
    // Bind position 2 is email_hash — the mocked hashEmailForRateLimit
    // returns `hash(<lowercased>)`. The presence of that prefix proves
    // the recorder went through the hash util; the absence of the raw
    // mixed-case email proves nothing skipped the hash on a code path.
    expect(binds[2]).toBe('hash(leak-me@example.com)')
    expect(binds[2]).not.toBe('Leak-Me@example.com')
    expect(binds[2]).not.toBe('leak-me@example.com')
  })
})
