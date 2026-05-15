import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  grantAccountRole,
  listLearnerCandidates,
  markAccountVerified,
  normalizeAccountEmail,
} from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import {
  isLearnerArchetypeCandidate,
} from '@/lib/auth/learner-archetype'
import { getDbPool } from '@/lib/db/pool'

import '../setup'

// PKG-RECON RECON.0 — drift detector. Pins both consumers of the
// canonical learner-archetype predicate to the same logic. Whenever
// a new "excluded" condition is added to the predicate, this test
// covers it because it exercises EVERY excluded condition AND
// asserts that BOTH the SQL filter (via listLearnerCandidates)
// AND the function check (via isLearnerArchetypeCandidate) reject
// identically.
//
// Round 1 BLOCKER #7 / round 2 WARN #6 / round 3 BLOCKER #1 closure.

const PWD = 'StrongPassword123'

async function makeAccount(email: string): Promise<string> {
  const account = await createAccount({
    email: normalizeAccountEmail(email),
    passwordHash: await hashPassword(PWD),
  })
  return account.id
}

describe('learner-archetype canonical predicate drift', () => {
  it('valid learner (verified + no extra-role): BOTH consumers accept', async () => {
    const id = await makeAccount('lap-valid@example.com')
    await markAccountVerified(id)
    expect(await isLearnerArchetypeCandidate(id)).toBe(true)
    const list = await listLearnerCandidates()
    expect(list.some((c) => c.id === id)).toBe(true)
  })

  it('unverified email: BOTH consumers reject', async () => {
    const id = await makeAccount('lap-unverified@example.com')
    // NOT markAccountVerified → email_verified_at is null
    expect(await isLearnerArchetypeCandidate(id)).toBe(false)
    const list = await listLearnerCandidates()
    expect(list.some((c) => c.id === id)).toBe(false)
  })

  it('disabled account: BOTH consumers reject', async () => {
    const id = await makeAccount('lap-disabled@example.com')
    await markAccountVerified(id)
    await getDbPool().query(
      `update accounts set disabled_at = now() where id = $1`,
      [id],
    )
    expect(await isLearnerArchetypeCandidate(id)).toBe(false)
    const list = await listLearnerCandidates()
    expect(list.some((c) => c.id === id)).toBe(false)
  })

  it('scheduled_purge_at set (deletion grace running): BOTH consumers reject', async () => {
    const id = await makeAccount('lap-scheduled-purge@example.com')
    await markAccountVerified(id)
    await getDbPool().query(
      `update accounts set scheduled_purge_at = now() + interval '30 days' where id = $1`,
      [id],
    )
    expect(await isLearnerArchetypeCandidate(id)).toBe(false)
    const list = await listLearnerCandidates()
    expect(list.some((c) => c.id === id)).toBe(false)
  })

  it('purged account: BOTH consumers reject', async () => {
    const id = await makeAccount('lap-purged@example.com')
    await markAccountVerified(id)
    await getDbPool().query(
      `update accounts set purged_at = now() where id = $1`,
      [id],
    )
    expect(await isLearnerArchetypeCandidate(id)).toBe(false)
    const list = await listLearnerCandidates()
    expect(list.some((c) => c.id === id)).toBe(false)
  })

  it('admin role: BOTH consumers reject', async () => {
    const id = await makeAccount('lap-admin@example.com')
    await markAccountVerified(id)
    await grantAccountRole(id, 'admin', null)
    expect(await isLearnerArchetypeCandidate(id)).toBe(false)
    const list = await listLearnerCandidates()
    expect(list.some((c) => c.id === id)).toBe(false)
  })

  it('teacher role: BOTH consumers reject', async () => {
    const id = await makeAccount('lap-teacher@example.com')
    await markAccountVerified(id)
    await grantAccountRole(id, 'teacher', null)
    expect(await isLearnerArchetypeCandidate(id)).toBe(false)
    const list = await listLearnerCandidates()
    expect(list.some((c) => c.id === id)).toBe(false)
  })

  it('non-existent account id: function rejects', async () => {
    const fake = '11111111-1111-4111-8111-111111111111'
    expect(await isLearnerArchetypeCandidate(fake)).toBe(false)
  })
})
