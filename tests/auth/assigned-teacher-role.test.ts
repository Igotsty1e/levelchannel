import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Codex 2026-05-08 (MEDIUM-LOW) — pin the teacher-role guard on
// setAssignedTeacher. Pre-fix, the function blindly UPDATE'd
// assigned_teacher_id to whatever UUID was passed.

// Both `setAssignedTeacher` and `listAccountRoles` live in the same
// module and `setAssignedTeacher` calls `listAccountRoles` by name
// internally. We can't mock that internal reference, so we mock at
// the underlying `getAuthPool` boundary — listAccountRoles is a
// SELECT against `account_roles`, setAssignedTeacher's UPDATE is
// against `accounts`, distinguishable by SQL text.

const queryMock = vi.fn()

vi.mock('@/lib/auth/pool', () => ({
  getAuthPool: () => ({ query: queryMock }),
}))

import {
  AssignedTeacherRoleError,
  setAssignedTeacher,
} from '@/lib/auth/accounts'

function mockRoles(roles: string[]) {
  queryMock.mockImplementationOnce(async (sql: string) => {
    if (!sql.includes('account_roles')) {
      throw new Error(`unexpected first query: ${sql}`)
    }
    return { rows: roles.map((r) => ({ role: r })) }
  })
}

function mockUpdateOk() {
  queryMock.mockImplementationOnce(async (sql: string) => {
    if (!sql.includes('update accounts')) {
      throw new Error(`unexpected second query: ${sql}`)
    }
    return { rowCount: 1 }
  })
}

describe('setAssignedTeacher — teacher-role guard', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('throws AssignedTeacherRoleError when target has no teacher role', async () => {
    mockRoles(['student'])
    await expect(
      setAssignedTeacher('learner-1', 'not-a-teacher-2'),
    ).rejects.toBeInstanceOf(AssignedTeacherRoleError)
    // Only one query fired (the role lookup); UPDATE never ran.
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('throws when target has admin role but no teacher role', async () => {
    mockRoles(['admin'])
    await expect(
      setAssignedTeacher('learner-1', 'admin-acct'),
    ).rejects.toBeInstanceOf(AssignedTeacherRoleError)
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('proceeds when target has teacher role', async () => {
    mockRoles(['teacher'])
    mockUpdateOk()
    await setAssignedTeacher('learner-1', 'teacher-acct')
    expect(queryMock).toHaveBeenCalledTimes(2)
    // Second call was the UPDATE with [learner-1, teacher-acct].
    expect(queryMock.mock.calls[1][1]).toEqual(['learner-1', 'teacher-acct'])
  })

  it('proceeds for unassign (teacherId=null) without role check', async () => {
    mockUpdateOk()
    await setAssignedTeacher('learner-1', null)
    // Only one query (UPDATE) — no role lookup since target is null.
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0][1]).toEqual(['learner-1', null])
  })
})
