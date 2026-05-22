import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Codex 2026-05-08 (MEDIUM-LOW) — pin the teacher-role guard on
// setAssignedTeacher. Pre-fix, the function blindly UPDATE'd
// assigned_teacher_id to whatever UUID was passed.

// Both `setAssignedTeacher` and `listAccountRoles` live in the same
// module and `setAssignedTeacher` calls `listAccountRoles` by name
// internally. We can't mock that internal reference, so we mock at
// the underlying `getAuthPool` boundary.
//
// listAccountRoles is a SELECT via pool.query (top-level).
// setAssignedTeacher (SAAS-PIVOT Day 2 dual-write) runs in a TX via
// pool.connect() → client.query(). The mock stubs both surfaces; SQL
// text distinguishes role lookup vs UPDATE accounts vs
// UPDATE/INSERT learner_teacher_links.

const poolQueryMock = vi.fn()
const clientQueryMock = vi.fn()
const releaseMock = vi.fn()

vi.mock('@/lib/auth/pool', () => ({
  getAuthPool: () => ({
    query: poolQueryMock,
    connect: async () => ({
      query: clientQueryMock,
      release: releaseMock,
    }),
  }),
}))

import {
  AssignedTeacherRoleError,
  setAssignedTeacher,
} from '@/lib/auth/accounts'

function mockRoles(roles: string[]) {
  poolQueryMock.mockImplementationOnce(async (sql: string) => {
    if (!sql.includes('account_roles')) {
      throw new Error(`unexpected first query: ${sql}`)
    }
    return { rows: roles.map((r) => ({ role: r })) }
  })
}

function mockTxOk() {
  // SAAS-PIVOT Day 2 (2026-05-22) — the dual-write TX issues:
  //   1. begin
  //   2. update accounts set assigned_teacher_id = $2 …
  //   3. EITHER unassign branch:
  //        update learner_teacher_links unlinked_at = now()
  //          where learner = $1 and unlinked_at is null
  //      OR assign branch (round-1 BLOCKER #1 closure):
  //        a. update learner_teacher_links unlinked_at = now()
  //             where learner = $1 and teacher <> $2 (soft-unlink old)
  //        b. insert into learner_teacher_links on conflict update
  //   4. commit
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (sql.startsWith('begin')) return { rowCount: 0 }
    if (sql.startsWith('commit')) return { rowCount: 0 }
    if (sql.includes('update accounts')) return { rowCount: 1 }
    if (sql.includes('learner_teacher_links')) return { rowCount: 1 }
    throw new Error(`unexpected client query: ${sql}`)
  })
}

describe('setAssignedTeacher — teacher-role guard + dual-write', () => {
  beforeEach(() => {
    poolQueryMock.mockReset()
    clientQueryMock.mockReset()
    releaseMock.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('throws AssignedTeacherRoleError when target has no teacher role', async () => {
    mockRoles(['student'])
    await expect(
      setAssignedTeacher('learner-1', 'not-a-teacher-2'),
    ).rejects.toBeInstanceOf(AssignedTeacherRoleError)
    // Only the role lookup fired; UPDATE never ran, TX never opened.
    expect(poolQueryMock).toHaveBeenCalledTimes(1)
    expect(clientQueryMock).not.toHaveBeenCalled()
  })

  it('throws when target has admin role but no teacher role', async () => {
    mockRoles(['admin'])
    await expect(
      setAssignedTeacher('learner-1', 'admin-acct'),
    ).rejects.toBeInstanceOf(AssignedTeacherRoleError)
    expect(poolQueryMock).toHaveBeenCalledTimes(1)
    expect(clientQueryMock).not.toHaveBeenCalled()
  })

  it('proceeds when target has teacher role (dual-write TX, soft-unlinks old links)', async () => {
    mockRoles(['teacher'])
    mockTxOk()
    await setAssignedTeacher('learner-1', 'teacher-acct')
    // Role lookup on the pool.
    expect(poolQueryMock).toHaveBeenCalledTimes(1)
    // begin + update accounts + soft-unlink old links + insert link + commit (5 calls).
    expect(clientQueryMock).toHaveBeenCalledTimes(5)
    // The release returned the client to the pool.
    expect(releaseMock).toHaveBeenCalledTimes(1)
    // Verify both writers carry the (learner, teacher) tuple.
    const sqlByCall = clientQueryMock.mock.calls.map((c) => c[0] as string)
    expect(sqlByCall.some((s) => s.includes('update accounts'))).toBe(true)
    expect(
      sqlByCall.some(
        (s) =>
          s.includes('learner_teacher_links') &&
          s.includes('teacher_account_id <> $2'),
      ),
    ).toBe(true)
    expect(
      sqlByCall.some(
        (s) =>
          s.includes('insert into learner_teacher_links') &&
          s.includes('on conflict'),
      ),
    ).toBe(true)
  })

  it('proceeds for unassign (teacherId=null) without role check, soft-unlinks links', async () => {
    mockTxOk()
    await setAssignedTeacher('learner-1', null)
    // No role lookup on the pool (target=null short-circuits).
    expect(poolQueryMock).not.toHaveBeenCalled()
    // begin + update accounts + update links unlinked_at + commit.
    expect(clientQueryMock).toHaveBeenCalledTimes(4)
    const sqlByCall = clientQueryMock.mock.calls.map((c) => c[0] as string)
    expect(
      sqlByCall.some((s) => s.includes('update learner_teacher_links')),
    ).toBe(true)
  })
})
