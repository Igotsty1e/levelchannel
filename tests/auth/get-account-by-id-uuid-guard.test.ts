import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sentry hotfix 2026-05-08 — `GET /admin/accounts/[id]` was throwing
// `invalid input syntax for type uuid` when the URL contained a
// literal `:id` (bot probe). The page's `if (!account) notFound()`
// branch only handles a clean null; a thrown Postgres error
// surfaces as a 500 + Sentry alert. The data-layer guard makes
// `getAccountById('not-a-uuid')` return null without hitting the DB.

const queryMock = vi.fn()
const getAuthPoolMock = vi.fn()

vi.mock('@/lib/auth/pool', () => ({
  getAuthPool: () => getAuthPoolMock(),
}))

import { getAccountById } from '@/lib/auth/accounts'

describe('getAccountById UUID guard (Sentry hotfix)', () => {
  beforeEach(() => {
    queryMock.mockReset()
    getAuthPoolMock.mockReset()
    getAuthPoolMock.mockReturnValue({ query: queryMock })
  })

  afterEach(() => vi.restoreAllMocks())

  it('returns null on the literal `:id` placeholder (bot probe shape)', async () => {
    const got = await getAccountById(':id')
    expect(got).toBeNull()
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns null on common bot probe shapes', async () => {
    for (const sample of [
      'undefined',
      'null',
      'admin',
      '../etc/passwd',
      '12345',
      '',
      '00000000-0000-0000-0000', // truncated uuid
      'not-a-uuid-at-all',
    ]) {
      expect(await getAccountById(sample)).toBeNull()
    }
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('passes through a well-formed UUID to the SQL query', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    const VALID_UUID = '11111111-1111-1111-1111-111111111111'

    const got = await getAccountById(VALID_UUID)

    expect(got).toBeNull() // no rows returned
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0][1]).toEqual([VALID_UUID])
  })
})
