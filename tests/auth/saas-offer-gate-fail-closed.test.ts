import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// security-audit-2026-06-02 Sub-PR 0 — F3a fail-CLOSED regression.
//
// The contract under test: when resolveOperatorSetting surfaces
// dbErrored=true (the canonical prod state — operator flipped flag
// via admin UI, DB has '1', env unset, then a transient DB error
// fires during the read) isSaasOfferGateEnabled MUST return true
// (gate considered ON) unless the env override is explicitly '0'.
//
// Prior bug: the catch in isSaasOfferGateEnabled never fired because
// resolveOperatorSetting swallows the throw internally and returns
// {value: schema.default = 0, source: 'default'}. The outer caller
// would silently bypass the gate.

vi.mock('@/lib/admin/operator-settings', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/admin/operator-settings')
  >('@/lib/admin/operator-settings')
  return {
    ...actual,
    resolveOperatorSetting: vi.fn(),
  }
})

import { isSaasOfferGateEnabled } from '@/lib/auth/guards'
import { resolveOperatorSetting } from '@/lib/admin/operator-settings'

const mockResolve = resolveOperatorSetting as unknown as ReturnType<
  typeof vi.fn
>

const savedEnv = process.env.SAAS_OFFER_GATE_ENABLED

beforeEach(() => {
  mockResolve.mockReset()
})

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env.SAAS_OFFER_GATE_ENABLED
  } else {
    process.env.SAAS_OFFER_GATE_ENABLED = savedEnv
  }
})

describe('isSaasOfferGateEnabled — F3a fail-CLOSED contract', () => {
  it('DB happy path: value=1 → gate ON', async () => {
    mockResolve.mockResolvedValue({
      value: 1,
      source: 'db',
      rawDb: '1',
      rawEnv: null,
      dbErrored: false,
    })
    delete process.env.SAAS_OFFER_GATE_ENABLED
    expect(await isSaasOfferGateEnabled()).toBe(true)
  })

  it('DB happy path: value=0 → gate OFF', async () => {
    mockResolve.mockResolvedValue({
      value: 0,
      source: 'db',
      rawDb: '0',
      rawEnv: null,
      dbErrored: false,
    })
    delete process.env.SAAS_OFFER_GATE_ENABLED
    expect(await isSaasOfferGateEnabled()).toBe(false)
  })

  it('CANONICAL PROD STATE: DB blip + env unset → fail-CLOSED (gate ON)', async () => {
    // resolveOperatorSetting's inner catch swallowed the DB error and
    // fell through to default (0). dbErrored carries the signal.
    mockResolve.mockResolvedValue({
      value: 0,
      source: 'default',
      rawDb: null,
      rawEnv: null,
      dbErrored: true,
    })
    delete process.env.SAAS_OFFER_GATE_ENABLED
    expect(await isSaasOfferGateEnabled()).toBe(true)
  })

  it('DB blip + env explicitly "0" → fail-OPEN (operator-asserted off)', async () => {
    mockResolve.mockResolvedValue({
      value: 0,
      source: 'default',
      rawDb: null,
      rawEnv: null,
      dbErrored: true,
    })
    process.env.SAAS_OFFER_GATE_ENABLED = '0'
    expect(await isSaasOfferGateEnabled()).toBe(false)
  })

  it('DB blip + env explicitly "1" → fail-CLOSED (gate ON)', async () => {
    mockResolve.mockResolvedValue({
      value: 1,
      source: 'env',
      rawDb: null,
      rawEnv: '1',
      dbErrored: true,
    })
    process.env.SAAS_OFFER_GATE_ENABLED = '1'
    expect(await isSaasOfferGateEnabled()).toBe(true)
  })

  it('DB blip + env whitespace-only → treated as unset, fail-CLOSED', async () => {
    mockResolve.mockResolvedValue({
      value: 0,
      source: 'default',
      rawDb: null,
      rawEnv: null,
      dbErrored: true,
    })
    process.env.SAAS_OFFER_GATE_ENABLED = '   '
    expect(await isSaasOfferGateEnabled()).toBe(true)
  })

  it('resolver throws unexpectedly → defensive fail-CLOSED (env unset)', async () => {
    mockResolve.mockRejectedValue(new Error('unexpected throw'))
    delete process.env.SAAS_OFFER_GATE_ENABLED
    expect(await isSaasOfferGateEnabled()).toBe(true)
  })

  it('resolver throws unexpectedly + env explicitly "0" → fail-OPEN', async () => {
    mockResolve.mockRejectedValue(new Error('unexpected throw'))
    process.env.SAAS_OFFER_GATE_ENABLED = '0'
    expect(await isSaasOfferGateEnabled()).toBe(false)
  })
})
