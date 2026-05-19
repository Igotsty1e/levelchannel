import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ALLOWED_TIMEZONES as TS_ALLOWED,
  TIMEZONE_OPTIONS,
  safeTimezone as tsSafeTimezone,
} from '@/lib/auth/timezones'

// BCS-DEF-5 (2026-05-19) — drift pin for scripts/lib/timezone.mjs vs
// lib/auth/timezones.ts. Plan: docs/plans/bcs-def-5-teacher-reminders.md
// §3.5.

describe('scripts/lib/timezone.mjs ↔ lib/auth/timezones.ts drift', () => {
  it('ALLOWED_TIMEZONES mjs array equals TS allowlist (id-by-id)', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const mjsPath = resolvePath(here, '../../scripts/lib/timezone.mjs')
    const mod = (await import(mjsPath)) as {
      ALLOWED_TIMEZONES: readonly string[]
      safeTimezone: (tz: string | null | undefined) => string
    }
    const tsIds = TIMEZONE_OPTIONS.map((t) => t.id)
    expect([...mod.ALLOWED_TIMEZONES]).toEqual(tsIds)
    // Sanity — the TS-side Set is derived from the same array.
    expect(tsIds.every((id) => TS_ALLOWED.has(id))).toBe(true)
  })

  it('safeTimezone() mjs returns same value as TS for the full equivalence class', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const mjsPath = resolvePath(here, '../../scripts/lib/timezone.mjs')
    const mod = (await import(mjsPath)) as {
      safeTimezone: (tz: string | null | undefined) => string
    }
    const cases: Array<string | null | undefined> = [
      'Europe/Moscow', // valid IANA in allowlist
      'Asia/Vladivostok', // valid IANA in allowlist
      'America/Los_Angeles', // valid IANA in allowlist
      'Australia/Sydney', // valid IANA OUTSIDE the allowlist → fallback
      null,
      undefined,
      '',
      'garbage',
      '   ',
      'utc',
    ]
    for (const c of cases) {
      expect(mod.safeTimezone(c)).toBe(tsSafeTimezone(c))
    }
  })
})
