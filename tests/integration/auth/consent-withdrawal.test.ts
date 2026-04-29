import { describe, expect, it } from 'vitest'

import {
  getActiveConsent,
  getLatestConsent,
  listAccountConsents,
  recordConsent,
  withdrawConsent,
} from '@/lib/auth/consents'
import { getAuthPool } from '@/lib/auth/pool'

import '../setup'

async function planAccount(email: string): Promise<string> {
  const { rows } = await getAuthPool().query(
    `insert into accounts (id, email, password_hash, created_at, updated_at)
     values (gen_random_uuid(), $1, '$2b$12$placeholderxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', now(), now())
     returning id`,
    [email],
  )
  return String(rows[0].id)
}

describe('consent withdrawal model (migration 0013)', () => {
  it('records acceptance with revokedAt = null', async () => {
    const accountId = await planAccount('cw-1@example.com')
    const consent = await recordConsent({
      accountId,
      documentKind: 'personal_data',
      documentVersion: 'v-test-1',
    })
    expect(consent.revokedAt).toBeNull()

    const active = await getActiveConsent(accountId, 'personal_data')
    expect(active?.id).toBe(consent.id)
  })

  it('withdrawConsent stamps revoked_at on the latest unrevoked row', async () => {
    const accountId = await planAccount('cw-2@example.com')

    // Two acceptances — re-acceptance after a version bump, common case.
    const first = await recordConsent({
      accountId,
      documentKind: 'personal_data',
      documentVersion: 'v-old',
      acceptedAt: new Date(Date.now() - 60_000).toISOString(),
    })
    const second = await recordConsent({
      accountId,
      documentKind: 'personal_data',
      documentVersion: 'v-new',
    })

    const revoked = await withdrawConsent({
      accountId,
      documentKind: 'personal_data',
    })

    expect(revoked).not.toBeNull()
    // The LATEST unrevoked row was the v-new one — that's what gets stamped.
    expect(revoked?.id).toBe(second.id)
    expect(revoked?.revokedAt).not.toBeNull()

    // The earlier acceptance is untouched — its factual record is preserved.
    const all = await listAccountConsents(accountId)
    const firstStill = all.find((c) => c.id === first.id)
    expect(firstStill?.revokedAt).toBeNull()
  })

  it('returns null active consent after withdrawal until re-acceptance', async () => {
    const accountId = await planAccount('cw-3@example.com')
    await recordConsent({
      accountId,
      documentKind: 'personal_data',
      documentVersion: 'v',
    })

    await withdrawConsent({ accountId, documentKind: 'personal_data' })
    expect(await getActiveConsent(accountId, 'personal_data')).toBeNull()

    // getLatestConsent still returns the row — it's the latest *acceptance*,
    // just one with revokedAt non-null. This is intentional: callers asking
    // "what did the user last sign?" need the row even if it was revoked.
    const latest = await getLatestConsent(accountId, 'personal_data')
    expect(latest?.revokedAt).not.toBeNull()

    // Re-accept: a fresh row with revokedAt=null becomes the active one.
    await recordConsent({
      accountId,
      documentKind: 'personal_data',
      documentVersion: 'v-renewed',
    })
    const active = await getActiveConsent(accountId, 'personal_data')
    expect(active?.documentVersion).toBe('v-renewed')
    expect(active?.revokedAt).toBeNull()
  })

  it('withdrawConsent returns null when there is no active consent', async () => {
    const accountId = await planAccount('cw-4@example.com')
    // Never recorded — withdrawal is a no-op.
    const revoked = await withdrawConsent({
      accountId,
      documentKind: 'personal_data',
    })
    expect(revoked).toBeNull()
  })

  it('withdrawal of one document_kind does not affect another', async () => {
    const accountId = await planAccount('cw-5@example.com')
    await recordConsent({
      accountId,
      documentKind: 'personal_data',
      documentVersion: 'v1',
    })
    await recordConsent({
      accountId,
      documentKind: 'marketing_opt_in',
      documentVersion: 'v1',
    })

    await withdrawConsent({ accountId, documentKind: 'marketing_opt_in' })

    expect(await getActiveConsent(accountId, 'personal_data')).not.toBeNull()
    expect(await getActiveConsent(accountId, 'marketing_opt_in')).toBeNull()
  })
})
