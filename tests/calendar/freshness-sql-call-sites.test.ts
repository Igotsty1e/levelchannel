// Code-quality audit 2026-06-02 F9 — drift guard for the read-side
// "active integration with fresh pull" gate.
//
// `lib/calendar/freshness-sql.ts` exports
// `ACTIVE_INTEGRATION_GATE_SQL` so the predicate lives in exactly one
// place. The known read-side call sites (4 inline interpolations
// across 2 files) must import the constant instead of inlining their
// own copies. If anyone forks the predicate back into place — or
// drops one of the interpolations — this test fails.
//
// Write-side lifecycle SQL in `lib/calendar/integrations.ts` and
// `lib/calendar/pull-runner.ts` is intentionally NOT in this list —
// those manage `sync_state`/`last_pulled_at` themselves and have
// their own NULL semantics (see `freshness-sql.ts` header).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ACTIVE_INTEGRATION_FRESHNESS_INTERVAL,
  ACTIVE_INTEGRATION_GATE_SQL,
} from '@/lib/calendar/freshness-sql'

const REPO_ROOT = resolve(__dirname, '..', '..')

// (call-site file, expected number of `${ACTIVE_INTEGRATION_GATE_SQL}`
// interpolations in that file). Update this table when a new call
// site is added — the F9 plan called for 4 inlines across 2 files:
// booking.ts has 2 (BUSY_OVERLAP_GATE_SQL + post-failure overlap
// probe), hidden-slots.ts has 2
// (listHiddenSlotsForTeacher + countHiddenSlotsForTeacher).
const KNOWN_CALL_SITES: ReadonlyArray<readonly [string, number]> = [
  ['lib/scheduling/slots/booking.ts', 2],
  ['lib/calendar/hidden-slots.ts', 2],
] as const

// Lines that LOOK LIKE the predicate but live inside the centralised
// constant itself or its drift guard — must NOT count as a fork.
const ALLOWED_DEFINITION_FILES = new Set<string>([
  'lib/calendar/freshness-sql.ts',
  'tests/calendar/freshness-sql-call-sites.test.ts',
])

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf8')
}

// Strip comments (single-line `//...` and block `/* ... */`) so the
// predicate substring inside an explanatory comment is NOT counted
// as a fork. Also drops obvious template-literal interpolations of
// the constant so the test focuses on the inline SQL only.
function stripCommentsAndConstantInterpolations(source: string): string {
  let next = source
  next = next.replace(/\/\*[\s\S]*?\*\//g, '')
  next = next.replace(/\/\/[^\n]*/g, '')
  next = next.replace(/\$\{ACTIVE_INTEGRATION_GATE_SQL\}/g, '')
  next = next.replace(/\$\{ACTIVE_INTEGRATION_FRESHNESS_INTERVAL\}/g, '')
  return next
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1
    idx += needle.length
  }
  return count
}

describe('freshness-sql gate centralisation (F9)', () => {
  it('exports a string constant assembled from the interval constant', () => {
    expect(ACTIVE_INTEGRATION_FRESHNESS_INTERVAL).toBe("interval '10 minutes'")
    expect(ACTIVE_INTEGRATION_GATE_SQL).toContain(
      ACTIVE_INTEGRATION_FRESHNESS_INTERVAL,
    )
    expect(ACTIVE_INTEGRATION_GATE_SQL).toMatch(/tci\.sync_state\s*=\s*'active'/)
    expect(ACTIVE_INTEGRATION_GATE_SQL).toMatch(
      /tci\.last_pulled_at\s*>=\s*now\(\)\s*-/,
    )
  })

  for (const [relPath, expectedInterpolations] of KNOWN_CALL_SITES) {
    describe(relPath, () => {
      const source = readRepoFile(relPath)

      it('imports ACTIVE_INTEGRATION_GATE_SQL from lib/calendar/freshness-sql', () => {
        // Find every import declaration that names the symbol; assert
        // the module specifier matches the centralised file. Multiline
        // imports (named import lists split across lines) are common,
        // so we match across newlines explicitly.
        const importPattern =
          /import[\s\S]*?ACTIVE_INTEGRATION_GATE_SQL[\s\S]*?from\s+['"]([^'"]+)['"]/g
        const matches: string[] = []
        let m: RegExpExecArray | null
        while ((m = importPattern.exec(source)) !== null) {
          matches.push(m[1])
        }
        expect(
          matches.length,
          `${relPath} must import ACTIVE_INTEGRATION_GATE_SQL at least once`,
        ).toBeGreaterThan(0)
        for (const specifier of matches) {
          expect(
            specifier,
            `${relPath} import must resolve to lib/calendar/freshness-sql, got ${specifier}`,
          ).toMatch(/^(@\/lib\/calendar\/freshness-sql|\.\/freshness-sql)$/)
        }
      })

      it(`interpolates ACTIVE_INTEGRATION_GATE_SQL exactly ${expectedInterpolations} times`, () => {
        const occurrences = countOccurrences(
          source,
          '${ACTIVE_INTEGRATION_GATE_SQL}',
        )
        expect(
          occurrences,
          `${relPath} has ${occurrences} interpolations; expected ${expectedInterpolations}. ` +
            `If a call site was intentionally added/removed, update KNOWN_CALL_SITES.`,
        ).toBe(expectedInterpolations)
      })

      it('does not inline the freshness predicate alongside the centralised constant', () => {
        const stripped = stripCommentsAndConstantInterpolations(source)

        // Catch any direct re-fork of `sync_state='active' ... last_pulled_at`
        // within ~200 chars (one SQL JOIN clause) and the explicit
        // 10-min interval literal. Both halves of the original gate.
        const forkedFullPredicate =
          /sync_state\s*=\s*'active'[\s\S]{0,200}last_pulled_at\s*>=\s*now\(\)\s*-\s*interval\s*'10 minutes'/
        expect(
          stripped,
          `${relPath} re-inlined the full freshness predicate alongside the centralised constant`,
        ).not.toMatch(forkedFullPredicate)

        // Also catch the half-fork (just the last_pulled_at clause)
        // because that's the part most likely to be tweaked
        // independently and would silently drift from the constant.
        const forkedLastPulledClause =
          /last_pulled_at\s*>=\s*now\(\)\s*-\s*interval\s*'10 minutes'/
        expect(
          stripped,
          `${relPath} re-inlined the last_pulled_at half of the predicate`,
        ).not.toMatch(forkedLastPulledClause)
      })
    })
  }

  it('write-side lifecycle files are NOT registered as call sites', () => {
    // R1-BLOCKER#3 closure marker: integrations.ts + pull-runner.ts
    // INTENTIONALLY manage `sync_state`/`last_pulled_at` themselves
    // and are excluded. If someone "centralises" them in a follow-up
    // they need to consciously update this guard.
    const writeSide = ['lib/calendar/integrations.ts', 'lib/calendar/pull-runner.ts']
    for (const relPath of writeSide) {
      expect(
        KNOWN_CALL_SITES.some(([p]) => p === relPath),
        `write-side lifecycle file ${relPath} is not a read-side gate; do not add it to KNOWN_CALL_SITES`,
      ).toBe(false)
      expect(ALLOWED_DEFINITION_FILES.has(relPath)).toBe(false)
    }
  })
})
