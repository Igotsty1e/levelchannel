import { describe, expect, it } from 'vitest'

import {
  ERR_CHECK_VIOLATION,
  ERR_FOREIGN_KEY_VIOLATION,
  ERR_UNDEFINED_TABLE,
  ERR_UNIQUE_VIOLATION,
  isCheckViolationError,
  isForeignKeyViolationError,
  isUndefinedTableError,
  isUniqueViolationError,
} from '@/lib/db/errors'

// AUDIT-CODE-3 (2026-05-17) — unit tests for the shared
// Postgres-SQLSTATE helpers extracted from probe-status.ts +
// test-send/route.ts. The helpers are pure functions over `unknown`,
// so unit tests are sufficient; integration coverage of the actual
// 42P01 path lives in tests/integration/admin/alerts-obs.test.ts.

describe('lib/db/errors — Postgres SQLSTATE helpers', () => {
  it('exports the canonical SQLSTATE constants', () => {
    expect(ERR_UNDEFINED_TABLE).toBe('42P01')
    expect(ERR_UNIQUE_VIOLATION).toBe('23505')
    expect(ERR_FOREIGN_KEY_VIOLATION).toBe('23503')
    expect(ERR_CHECK_VIOLATION).toBe('23514')
  })

  it('isUndefinedTableError matches 42P01 on a pg-shaped error', () => {
    expect(isUndefinedTableError({ code: '42P01' })).toBe(true)
    expect(isUndefinedTableError({ code: '42P01', message: 'relation "x" does not exist' })).toBe(true)
  })

  it('isUndefinedTableError rejects unrelated codes', () => {
    expect(isUndefinedTableError({ code: '23505' })).toBe(false)
    expect(isUndefinedTableError({ code: 42 })).toBe(false) // non-string code
    expect(isUndefinedTableError({ code: '42p01' })).toBe(false) // wrong case
  })

  it('isUndefinedTableError tolerates non-object inputs (returns false)', () => {
    expect(isUndefinedTableError(null)).toBe(false)
    expect(isUndefinedTableError(undefined)).toBe(false)
    expect(isUndefinedTableError('42P01')).toBe(false)
    expect(isUndefinedTableError(42)).toBe(false)
    expect(isUndefinedTableError(new Error('boom'))).toBe(false) // Error without .code
  })

  it('isUniqueViolationError matches 23505 specifically', () => {
    expect(isUniqueViolationError({ code: '23505' })).toBe(true)
    expect(isUniqueViolationError({ code: '23503' })).toBe(false)
    expect(isUniqueViolationError(null)).toBe(false)
  })

  it('isForeignKeyViolationError matches 23503 specifically', () => {
    expect(isForeignKeyViolationError({ code: '23503' })).toBe(true)
    expect(isForeignKeyViolationError({ code: '23505' })).toBe(false)
  })

  it('isCheckViolationError matches 23514 specifically', () => {
    expect(isCheckViolationError({ code: '23514' })).toBe(true)
    expect(isCheckViolationError({ code: '23505' })).toBe(false)
  })
})
