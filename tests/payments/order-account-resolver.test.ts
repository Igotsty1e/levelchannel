import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// SBP-PAY (2026-05-19) — pins the resolver contract per §0a BLOCKER#4
// + §0b WARN#2 + §0c WARN#2 closures:
//   - guest (no session)             → null
//   - admin session                  → null (anti-spoof)
//   - learner session                → account.id
//   - learner + teacher hybrid       → account.id (allowed; tighter
//                                       boundary than receipt-gate
//                                       consumer which still rejects
//                                       teacher on session-fallback)
//   - role-lookup failure            → null (fail closed)

// Mocks
const mockGetCurrentSession = vi.fn()
const mockListAccountRoles = vi.fn()

vi.mock('@/lib/auth/sessions', () => ({
  getCurrentSession: (...args: unknown[]) => mockGetCurrentSession(...args),
}))

vi.mock('@/lib/auth/accounts', () => ({
  listAccountRoles: (...args: unknown[]) => mockListAccountRoles(...args),
}))

// Imported AFTER vi.mock so the inner imports resolve to the mocks.
const { resolveOrderAccountIdForCreate } = await import(
  '@/lib/payments/order-account-resolver'
)

const dummyRequest = new Request('http://localhost:3000/api/payments/sbp/create-qr')

beforeEach(() => {
  mockGetCurrentSession.mockReset()
  mockListAccountRoles.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveOrderAccountIdForCreate', () => {
  it('returns null for guests (no session)', async () => {
    mockGetCurrentSession.mockResolvedValue(null)
    expect(await resolveOrderAccountIdForCreate(dummyRequest)).toBeNull()
  })

  it('returns account.id for a learner-only session', async () => {
    mockGetCurrentSession.mockResolvedValue({
      account: { id: 'a-learner-uuid' },
    })
    mockListAccountRoles.mockResolvedValue(['student'])
    expect(await resolveOrderAccountIdForCreate(dummyRequest)).toBe(
      'a-learner-uuid',
    )
  })

  it('returns account.id for a learner-with-teacher hybrid session', async () => {
    mockGetCurrentSession.mockResolvedValue({
      account: { id: 'a-hybrid-uuid' },
    })
    mockListAccountRoles.mockResolvedValue(['student', 'teacher'])
    expect(await resolveOrderAccountIdForCreate(dummyRequest)).toBe(
      'a-hybrid-uuid',
    )
  })

  it('returns null for an admin session (anti-spoof)', async () => {
    mockGetCurrentSession.mockResolvedValue({
      account: { id: 'an-admin-uuid' },
    })
    mockListAccountRoles.mockResolvedValue(['admin'])
    expect(await resolveOrderAccountIdForCreate(dummyRequest)).toBeNull()
  })

  it('fails closed (returns null) when role lookup throws', async () => {
    mockGetCurrentSession.mockResolvedValue({
      account: { id: 'a-mystery-uuid' },
    })
    mockListAccountRoles.mockRejectedValue(new Error('auth store down'))
    expect(await resolveOrderAccountIdForCreate(dummyRequest)).toBeNull()
  })

  it('returns account.id for teacher-only session (still less-privileged than read-fallback)', async () => {
    // Tighter than the receipt-gate's resolveSessionAccountIdForReceiptGate
    // (which rejects teachers). The trust-boundary differential is
    // justified — creating an order with your own metadata.accountId
    // is strictly less-privileged than reading any order via the
    // session-fallback. See §0b WARN#2 closure.
    mockGetCurrentSession.mockResolvedValue({
      account: { id: 'a-teacher-uuid' },
    })
    mockListAccountRoles.mockResolvedValue(['teacher'])
    expect(await resolveOrderAccountIdForCreate(dummyRequest)).toBe(
      'a-teacher-uuid',
    )
  })
})
