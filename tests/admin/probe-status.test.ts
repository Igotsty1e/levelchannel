import { describe, expect, it } from 'vitest'

// BCS-DEF-1-TEST-FILLOUT item 3 (2026-05-19) — structural regression
// pin for `lib/admin/probe-status.ts`. Phase 4 of the BCS-DEF-1 epic
// extended `PROBE_NAMES` + `ProbeName` + `isProbeName` with the 4th
// probe `'conflict-unresolved'`. This unit test pins that contract so
// a future PR can't silently drop the 4th probe (or add a 5th without
// updating the type guard and the readonly array together).
//
// Sibling integration tests (`tests/integration/admin/alerts-obs.test.ts`,
// `tests/integration/admin/conflict-unresolved-foundation.test.ts`)
// cover the DB-side behaviour of `getProbeStatus()` and the CHECK
// extension on `probe_runs.probe_name`. This file is unit-only — no
// DB, no network.

import {
  isProbeName,
  PROBE_NAMES,
  type ProbeName,
} from '@/lib/admin/probe-status'

describe('PROBE_NAMES — readonly registry', () => {
  it('contains exactly 4 probes (BCS-DEF-1 Phase 4 widened from 3)', () => {
    expect(PROBE_NAMES.length).toBe(4)
  })

  it('includes auth-flow', () => {
    expect(PROBE_NAMES).toContain('auth-flow')
  })

  it('includes calendar-pathology', () => {
    expect(PROBE_NAMES).toContain('calendar-pathology')
  })

  it('includes webhook-flow', () => {
    expect(PROBE_NAMES).toContain('webhook-flow')
  })

  it('includes conflict-unresolved (BCS-DEF-1 Phase 4)', () => {
    expect(PROBE_NAMES).toContain('conflict-unresolved')
  })

  it('has no duplicate entries', () => {
    expect(new Set(PROBE_NAMES).size).toBe(PROBE_NAMES.length)
  })
})

describe('isProbeName — type guard', () => {
  it('accepts auth-flow', () => {
    expect(isProbeName('auth-flow')).toBe(true)
  })

  it('accepts calendar-pathology', () => {
    expect(isProbeName('calendar-pathology')).toBe(true)
  })

  it('accepts webhook-flow', () => {
    expect(isProbeName('webhook-flow')).toBe(true)
  })

  it('accepts conflict-unresolved (BCS-DEF-1 Phase 4)', () => {
    expect(isProbeName('conflict-unresolved')).toBe(true)
  })

  it('rejects bogus strings', () => {
    expect(isProbeName('bogus')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isProbeName('')).toBe(false)
  })

  it('rejects non-string inputs (number, null, undefined, object)', () => {
    expect(isProbeName(0)).toBe(false)
    expect(isProbeName(null)).toBe(false)
    expect(isProbeName(undefined)).toBe(false)
    expect(isProbeName({})).toBe(false)
  })

  it('every entry in PROBE_NAMES passes isProbeName (registry/guard parity)', () => {
    for (const name of PROBE_NAMES) {
      expect(isProbeName(name)).toBe(true)
    }
  })
})

describe('ProbeName union — compile-time exhaustiveness', () => {
  it('rejects a switch that omits conflict-unresolved at compile time', () => {
    // Exhaustive switch over ProbeName: assigning the unhandled case
    // to `never` is the canonical TS exhaustiveness pattern. Missing
    // any case (e.g. dropping 'conflict-unresolved') would make the
    // input non-`never` and trip the @ts-expect-error directive below,
    // failing the build. Runtime body is a no-op — the assertion is
    // purely compile-time.
    function handle(p: ProbeName): string {
      switch (p) {
        case 'auth-flow':
          return 'a'
        case 'calendar-pathology':
          return 'b'
        case 'webhook-flow':
          return 'c'
        // @ts-expect-error — switch is intentionally missing
        // 'conflict-unresolved' to prove the ProbeName union still
        // includes it and TS exhaustiveness still catches the gap.
        default: {
          const _exhaustive: never = p
          return _exhaustive
        }
      }
    }

    // Smoke-call the handled arms so the function isn't dead code.
    expect(handle('auth-flow')).toBe('a')
    expect(handle('calendar-pathology')).toBe('b')
    expect(handle('webhook-flow')).toBe('c')
  })
})
