import { describe, expect, it, vi } from 'vitest'

// BCS-DEF-1 Phase 2 (2026-05-19) — unit tests for the probe's pure
// helpers. `scripts/conflict-unresolved-alert.mjs` exports
// `fingerprint`, `buildEmail`, `readOffenderRows`, `readOffenderCounts`,
// `readPerTeacherOmittedCounts`, `readFingerprintTuples` as named
// exports so this test can import them without invoking `main()` (the
// `if (invokedDirectly) { main() }` guard at the bottom keeps the file
// safe to import).
//
// BCS-DEF-1-TEST-FILLOUT item 6 (2026-05-19) — the DB-touching readers
// (`readOffenderCounts`, `readOffenderRows`, `readPerTeacherOmittedCounts`,
// `readFingerprintTuples`) are now covered below via a `vi.fn()`-mocked
// `pool.query`. No live Postgres, no network — tests assert each
// helper's row-to-object shape mapping and the right SQL bind order.
// Live-DB behaviour (CHECK constraints, ROW_NUMBER ordering, snapshot
// isolation across the four reads) remains covered by
// `tests/integration/admin/conflict-unresolved-foundation.test.ts` and
// the planned execFile probe-driven integration test.

// Dynamic import keeps vitest's TypeScript transform from choking on
// the .mjs module before runtime — same pattern used by the existing
// `tests/admin/operator-settings.test.ts` to load the .mjs mirror.
const moduleUrl = new URL(
  '../../scripts/conflict-unresolved-alert.mjs',
  import.meta.url,
).href

interface MockPool {
  query: ReturnType<typeof vi.fn>
}

async function loadModule() {
  return (await import(moduleUrl)) as {
    fingerprint: (offenders: ReadonlyArray<{
      teacherAccountId: string
      slotId: string
      conflictSourceCalendarId: string | null
      conflictSourceEventId: string | null
    }>) => string
    buildEmail: (
      offenders: ReadonlyArray<{
        slotId: string
        teacherAccountId: string
        teacherEmail: string
        startAt: string
        durationMinutes: number
        externalConflictAt: string
        conflictSourceCalendarId: string | null
        conflictSourceEventId: string | null
        rnPerTeacher: number
      }>,
      counts: { totalConflicts: number; totalTeachers: number },
      perTeacherOmitted: Map<string, number>,
    ) => { subject: string; text: string }
    readOffenderCounts: (
      pool: MockPool,
      thresholdMinutes: number,
    ) => Promise<{ totalConflicts: number; totalTeachers: number }>
    readOffenderRows: (
      pool: MockPool,
      thresholdMinutes: number,
      perTeacherLimit: number,
      reportLimit: number,
    ) => Promise<
      Array<{
        slotId: string
        teacherAccountId: string
        startAt: string
        durationMinutes: number
        externalConflictAt: string
        conflictSourceCalendarId: string | null
        conflictSourceEventId: string | null
        teacherEmail: string
        rnPerTeacher: number
      }>
    >
    readPerTeacherOmittedCounts: (
      pool: MockPool,
      thresholdMinutes: number,
      perTeacherLimit: number,
    ) => Promise<Map<string, number>>
    readFingerprintTuples: (
      pool: MockPool,
      thresholdMinutes: number,
    ) => Promise<
      Array<{
        slotId: string
        teacherAccountId: string
        conflictSourceCalendarId: string | null
        conflictSourceEventId: string | null
      }>
    >
  }
}

describe('fingerprint() — full-tuple hash', () => {
  it('is deterministic across input reorderings', async () => {
    const { fingerprint } = await loadModule()
    const a = [
      {
        teacherAccountId: 't1',
        slotId: 's1',
        conflictSourceCalendarId: 'cal-a',
        conflictSourceEventId: 'ev-x',
      },
      {
        teacherAccountId: 't2',
        slotId: 's2',
        conflictSourceCalendarId: 'cal-b',
        conflictSourceEventId: 'ev-y',
      },
    ]
    const b = [...a].reverse()
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('changes when conflict_source_calendar_id differs (round-1 BLOCKER #5 regression pin)', async () => {
    const { fingerprint } = await loadModule()
    const base = {
      teacherAccountId: 't1',
      slotId: 's1',
      conflictSourceEventId: 'ev-x',
    }
    const fpA = fingerprint([{ ...base, conflictSourceCalendarId: 'cal-a' }])
    const fpB = fingerprint([{ ...base, conflictSourceCalendarId: 'cal-b' }])
    expect(fpA).not.toBe(fpB)
  })

  it('changes when slot composition changes', async () => {
    const { fingerprint } = await loadModule()
    const base = {
      teacherAccountId: 't1',
      conflictSourceCalendarId: 'cal-a',
      conflictSourceEventId: 'ev-x',
    }
    const fpA = fingerprint([{ ...base, slotId: 's1' }])
    const fpB = fingerprint([
      { ...base, slotId: 's1' },
      { ...base, slotId: 's2' },
    ])
    expect(fpA).not.toBe(fpB)
  })

  it('tolerates null calendar/event source', async () => {
    const { fingerprint } = await loadModule()
    const fp = fingerprint([
      {
        teacherAccountId: 't1',
        slotId: 's1',
        conflictSourceCalendarId: null,
        conflictSourceEventId: null,
      },
    ])
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('produces 16-char hex digest', async () => {
    const { fingerprint } = await loadModule()
    const fp = fingerprint([
      {
        teacherAccountId: 't1',
        slotId: 's1',
        conflictSourceCalendarId: 'cal',
        conflictSourceEventId: 'ev',
      },
    ])
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('empty input returns a stable hash', async () => {
    const { fingerprint } = await loadModule()
    expect(fingerprint([])).toBe(fingerprint([]))
  })
})

describe('buildEmail() — operator email body', () => {
  function fixtureOffender(overrides: Record<string, unknown> = {}) {
    return {
      slotId: 'slot-1',
      teacherAccountId: 'teacher-1',
      teacherEmail: 'teach@example.com',
      startAt: '2026-05-20T14:00:00.000Z',
      durationMinutes: 60,
      externalConflictAt: '2026-05-19T08:00:00.000Z',
      conflictSourceCalendarId: 'cal-google',
      conflictSourceEventId: 'ev-x',
      rnPerTeacher: 1,
      ...overrides,
    } as const
  }

  it('subject contains conflict + teacher counts + threshold', async () => {
    const { buildEmail } = await loadModule()
    const { subject } = buildEmail(
      [fixtureOffender()],
      { totalConflicts: 1, totalTeachers: 1 },
      new Map(),
    )
    expect(subject).toContain('LevelChannel')
    expect(subject).toContain('Нерешённые конфликты')
    expect(subject).toContain('1')
    expect(subject).toContain('порог')
  })

  it('text body includes /admin/accounts deep-link per teacher', async () => {
    const { buildEmail } = await loadModule()
    const { text } = buildEmail(
      [fixtureOffender({ teacherAccountId: 'abc-uuid' })],
      { totalConflicts: 1, totalTeachers: 1 },
      new Map(),
    )
    expect(text).toContain('/admin/accounts/abc-uuid')
  })

  it('shows "и ещё N конфликтов не показано" line when per-teacher omitted >0', async () => {
    const { buildEmail } = await loadModule()
    const omitted = new Map([['teacher-1', 3]])
    const { text } = buildEmail(
      [fixtureOffender()],
      { totalConflicts: 4, totalTeachers: 1 },
      omitted,
    )
    expect(text).toContain('и ещё 3')
    expect(text).toContain('у этого учителя')
    expect(text).toContain('CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT')
  })

  it('omits "и ещё" line when no per-teacher overflow', async () => {
    const { buildEmail } = await loadModule()
    const { text } = buildEmail(
      [fixtureOffender()],
      { totalConflicts: 1, totalTeachers: 1 },
      new Map(),
    )
    expect(text).not.toContain('и ещё')
  })

  it('groups multiple slots under a single teacher header', async () => {
    const { buildEmail } = await loadModule()
    const { text } = buildEmail(
      [
        fixtureOffender({ slotId: 'slot-1', rnPerTeacher: 1 }),
        fixtureOffender({ slotId: 'slot-2', rnPerTeacher: 2 }),
      ],
      { totalConflicts: 2, totalTeachers: 1 },
      new Map(),
    )
    expect(text).toContain('slot-1')
    expect(text).toContain('slot-2')
    // Single teacher header — only ONE occurrence of the teacher email
    // in a "— учитель X" header context.
    const headerMatches = text.match(/— учитель teach@example\.com/g)
    expect(headerMatches?.length).toBe(1)
  })

  it('renders multiple teachers as separate blocks', async () => {
    const { buildEmail } = await loadModule()
    const { text } = buildEmail(
      [
        fixtureOffender({
          teacherAccountId: 't1',
          teacherEmail: 'a@x.com',
          slotId: 'slot-a',
        }),
        fixtureOffender({
          teacherAccountId: 't2',
          teacherEmail: 'b@x.com',
          slotId: 'slot-b',
        }),
      ],
      { totalConflicts: 2, totalTeachers: 2 },
      new Map(),
    )
    expect(text).toContain('a@x.com')
    expect(text).toContain('b@x.com')
    expect(text).toContain('/admin/accounts/t1')
    expect(text).toContain('/admin/accounts/t2')
  })

  it('includes conflict source calendar + event ids in slot body', async () => {
    const { buildEmail } = await loadModule()
    const { text } = buildEmail(
      [
        fixtureOffender({
          conflictSourceCalendarId: 'teacher.calendar@google.com',
          conflictSourceEventId: 'ev123xyz',
        }),
      ],
      { totalConflicts: 1, totalTeachers: 1 },
      new Map(),
    )
    expect(text).toContain('teacher.calendar@google.com')
    expect(text).toContain('ev123xyz')
  })

  it('renders "—" when conflict source ids are null', async () => {
    const { buildEmail } = await loadModule()
    const { text } = buildEmail(
      [
        fixtureOffender({
          conflictSourceCalendarId: null,
          conflictSourceEventId: null,
        }),
      ],
      { totalConflicts: 1, totalTeachers: 1 },
      new Map(),
    )
    expect(text).toContain('calendar=— event=—')
  })

  it('footer carries threshold + dedup snapshot for forensic forensic clarity', async () => {
    const { buildEmail } = await loadModule()
    const { text } = buildEmail(
      [fixtureOffender()],
      { totalConflicts: 1, totalTeachers: 1 },
      new Map(),
    )
    expect(text).toContain('Внутрипробные пороги')
    expect(text).toContain('threshold=')
    expect(text).toContain('per_teacher_limit=')
    expect(text).toContain('report_limit=')
    expect(text).toContain('dedup_window=')
  })
})

// --- BCS-DEF-1-TEST-FILLOUT item 6 — DB-helper unit mocks ----------
//
// Each helper is invoked with a `vi.fn()`-mocked pool. We assert:
//   (a) the helper's promise resolves to the expected shape (rows
//       mapped to the canonical camelCase object the rest of the
//       probe consumes), and
//   (b) the SQL bind order matches the helper's signature (so a
//       future refactor that swaps `$1` and `$2` blows up here, not
//       silently on prod).
//
// We do NOT assert the SQL string body — that's the integration
// test's job. We DO assert the parameter array because shape drift
// there is silent on prod (Postgres will happily run a query with
// the wrong int values).

function makeMockPool(rows: Array<Record<string, unknown>>): MockPool {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('readOffenderCounts() — mocked pool', () => {
  it('maps total + teachers_total to camelCase result shape', async () => {
    const { readOffenderCounts } = await loadModule()
    const pool = makeMockPool([{ total: 7, teachers_total: 3 }])

    const result = await readOffenderCounts(pool, 120)

    expect(result).toEqual({ totalConflicts: 7, totalTeachers: 3 })
    expect(pool.query).toHaveBeenCalledTimes(1)
    const [, binds] = pool.query.mock.calls[0]
    expect(binds).toEqual([120])
  })

  it('returns zeros when the row is missing (empty result set)', async () => {
    const { readOffenderCounts } = await loadModule()
    const pool = makeMockPool([])

    const result = await readOffenderCounts(pool, 60)

    expect(result).toEqual({ totalConflicts: 0, totalTeachers: 0 })
  })
})

describe('readOffenderRows() — mocked pool', () => {
  it('maps each row to canonical camelCase shape + ISO strings', async () => {
    const { readOffenderRows } = await loadModule()
    const pool = makeMockPool([
      {
        slot_id: 'slot-1',
        teacher_account_id: 'teacher-1',
        start_at: '2026-05-20T14:00:00.000Z',
        duration_minutes: 60,
        external_conflict_at: '2026-05-19T08:00:00.000Z',
        conflict_source_calendar_id: 'cal-google',
        conflict_source_event_id: 'ev-x',
        teacher_email: 'teach@example.com',
        rn_per_teacher: 1,
      },
      {
        slot_id: 'slot-2',
        teacher_account_id: 'teacher-1',
        start_at: '2026-05-20T15:00:00.000Z',
        duration_minutes: 45,
        external_conflict_at: '2026-05-19T09:00:00.000Z',
        conflict_source_calendar_id: null,
        conflict_source_event_id: null,
        teacher_email: 'teach@example.com',
        rn_per_teacher: 2,
      },
    ])

    const rows = await readOffenderRows(pool, 120, 5, 50)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      slotId: 'slot-1',
      teacherAccountId: 'teacher-1',
      startAt: '2026-05-20T14:00:00.000Z',
      durationMinutes: 60,
      externalConflictAt: '2026-05-19T08:00:00.000Z',
      conflictSourceCalendarId: 'cal-google',
      conflictSourceEventId: 'ev-x',
      teacherEmail: 'teach@example.com',
      rnPerTeacher: 1,
    })
    expect(rows[1].conflictSourceCalendarId).toBeNull()
    expect(rows[1].conflictSourceEventId).toBeNull()

    const [, binds] = pool.query.mock.calls[0]
    expect(binds).toEqual([120, 5, 50])
  })

  it('returns [] when no rows match', async () => {
    const { readOffenderRows } = await loadModule()
    const pool = makeMockPool([])

    const rows = await readOffenderRows(pool, 120, 5, 50)

    expect(rows).toEqual([])
  })
})

describe('readPerTeacherOmittedCounts() — mocked pool', () => {
  it('returns a Map keyed by teacher_account_id with numeric omitted counts', async () => {
    const { readPerTeacherOmittedCounts } = await loadModule()
    const pool = makeMockPool([
      { teacher_account_id: 'teacher-1', omitted: 3 },
      { teacher_account_id: 'teacher-2', omitted: 11 },
    ])

    const map = await readPerTeacherOmittedCounts(pool, 120, 5)

    expect(map).toBeInstanceOf(Map)
    expect(map.size).toBe(2)
    expect(map.get('teacher-1')).toBe(3)
    expect(map.get('teacher-2')).toBe(11)

    const [, binds] = pool.query.mock.calls[0]
    expect(binds).toEqual([120, 5])
  })

  it('returns an empty Map when no overflow rows', async () => {
    const { readPerTeacherOmittedCounts } = await loadModule()
    const pool = makeMockPool([])

    const map = await readPerTeacherOmittedCounts(pool, 120, 5)

    expect(map).toBeInstanceOf(Map)
    expect(map.size).toBe(0)
  })
})

describe('readFingerprintTuples() — mocked pool', () => {
  it('returns array of minimal fingerprint tuples', async () => {
    const { readFingerprintTuples } = await loadModule()
    const pool = makeMockPool([
      {
        slot_id: 'slot-1',
        teacher_account_id: 'teacher-1',
        conflict_source_calendar_id: 'cal-a',
        conflict_source_event_id: 'ev-1',
      },
      {
        slot_id: 'slot-2',
        teacher_account_id: 'teacher-2',
        conflict_source_calendar_id: null,
        conflict_source_event_id: null,
      },
    ])

    const tuples = await readFingerprintTuples(pool, 120)

    expect(tuples).toHaveLength(2)
    expect(tuples[0]).toEqual({
      slotId: 'slot-1',
      teacherAccountId: 'teacher-1',
      conflictSourceCalendarId: 'cal-a',
      conflictSourceEventId: 'ev-1',
    })
    expect(tuples[1]).toEqual({
      slotId: 'slot-2',
      teacherAccountId: 'teacher-2',
      conflictSourceCalendarId: null,
      conflictSourceEventId: null,
    })

    const [, binds] = pool.query.mock.calls[0]
    expect(binds).toEqual([120])
  })
})

// bcs-def-1-fanout impl — unit tests for the new fan-out helpers.
describe('groupOffendersByTeacher() — Map by teacher_account_id', () => {
  it('preserves input order and groups slots correctly', async () => {
    const mod = (await loadModule()) as unknown as {
      groupOffendersByTeacher: (offenders: ReadonlyArray<{
        teacherAccountId: string
        teacherEmail: string
        slotId: string
        conflictSourceCalendarId: string | null
        conflictSourceEventId: string | null
      }>) => Map<string, {
        teacherAccountId: string
        teacherEmail: string
        slots: Array<unknown>
      }>
    }
    const grouped = mod.groupOffendersByTeacher([
      { teacherAccountId: 't1', teacherEmail: 'a@x', slotId: 's1', conflictSourceCalendarId: null, conflictSourceEventId: null },
      { teacherAccountId: 't2', teacherEmail: 'b@x', slotId: 's2', conflictSourceCalendarId: null, conflictSourceEventId: null },
      { teacherAccountId: 't1', teacherEmail: 'a@x', slotId: 's3', conflictSourceCalendarId: null, conflictSourceEventId: null },
    ])
    expect(grouped.size).toBe(2)
    expect(grouped.get('t1')?.slots).toHaveLength(2)
    expect(grouped.get('t2')?.slots).toHaveLength(1)
    expect(grouped.get('t1')?.teacherEmail).toBe('a@x')
  })
})

describe('perTeacherFingerprint() — stable hash over slot tuples', () => {
  it('is reorder-insensitive', async () => {
    const mod = (await loadModule()) as unknown as {
      perTeacherFingerprint: (slots: ReadonlyArray<{
        slotId: string
        conflictSourceCalendarId: string | null
        conflictSourceEventId: string | null
      }>) => string
    }
    const a = [
      { slotId: 's1', conflictSourceCalendarId: 'c1', conflictSourceEventId: 'e1' },
      { slotId: 's2', conflictSourceCalendarId: 'c2', conflictSourceEventId: 'e2' },
    ]
    const b = [...a].reverse()
    expect(mod.perTeacherFingerprint(a)).toBe(mod.perTeacherFingerprint(b))
  })

  it('changes when a slot is added', async () => {
    const mod = (await loadModule()) as unknown as {
      perTeacherFingerprint: (slots: ReadonlyArray<{
        slotId: string
        conflictSourceCalendarId: string | null
        conflictSourceEventId: string | null
      }>) => string
    }
    const a = [{ slotId: 's1', conflictSourceCalendarId: 'c', conflictSourceEventId: 'e' }]
    const b = [...a, { slotId: 's2', conflictSourceCalendarId: 'c', conflictSourceEventId: 'e' }]
    expect(mod.perTeacherFingerprint(a)).not.toBe(mod.perTeacherFingerprint(b))
  })
})

// bcs-def-1-fanout impl wave-paranoia R2 INFO #2 closure (2026-06-04) —
// regression pin for the 42703 (undefined_column) retry path. Sibling
// probes never pass alertAudience, so their INSERT is bytewise the same
// as pre-mig; the test below covers the conflict-unresolved path where
// alertAudience IS passed but the column does not exist (rolling-deploy
// window NEW code + pre-0104 DB).
describe('recordProbeRun() — backward-compat 42703 fallback', () => {
  it('retries without alert_audience column when first INSERT trips 42703', async () => {
    const { recordProbeRun, PROBE_NAMES, VERDICT_KINDS } = (await import(
      new URL('../../scripts/lib/probe-runs.mjs', import.meta.url).href
    )) as unknown as {
      recordProbeRun: (pool: { query: ReturnType<typeof vi.fn> }, params: Record<string, unknown>) => Promise<void>
      PROBE_NAMES: Record<string, string>
      VERDICT_KINDS: Record<string, string>
    }
    const undefinedColumn = Object.assign(new Error('column "alert_audience" of relation "probe_runs" does not exist'), {
      code: '42703',
    })
    let callIdx = 0
    const queries: Array<{ text: string; values: unknown[] }> = []
    const pool = {
      query: vi.fn(async (text: string, values: unknown[]) => {
        queries.push({ text, values })
        callIdx += 1
        if (callIdx === 1) throw undefinedColumn
        return { rows: [], rowCount: 1 }
      }),
    }
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
      alertAudience: 'operator',
      verdictKind: VERDICT_KINDS.NO_OFFENDERS,
    })
    expect(queries).toHaveLength(2)
    expect(queries[0].text).toContain('alert_audience')
    expect(queries[1].text).not.toContain('alert_audience')
    // Fallback INSERT has 11 columns (no alert_audience), so 11 values.
    expect(queries[1].values).toHaveLength(11)
  })

  it('does NOT retry on errors other than 42703', async () => {
    const { recordProbeRun, PROBE_NAMES, VERDICT_KINDS } = (await import(
      new URL('../../scripts/lib/probe-runs.mjs', import.meta.url).href
    )) as unknown as {
      recordProbeRun: (pool: { query: ReturnType<typeof vi.fn> }, params: Record<string, unknown>) => Promise<void>
      PROBE_NAMES: Record<string, string>
      VERDICT_KINDS: Record<string, string>
    }
    const otherErr = Object.assign(new Error('CHECK constraint violated'), { code: '23514' })
    const pool = { query: vi.fn(async () => { throw otherErr }) }
    // Best-effort guarantee: recordProbeRun NEVER throws — the helper
    // logs + swallows. Verify the single attempt + no retry.
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.CONFLICT_UNRESOLVED,
      alertAudience: 'operator',
      verdictKind: VERDICT_KINDS.ERROR,
    })
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('omits alert_audience column entirely when caller never sets it (sibling-probe compat)', async () => {
    const { recordProbeRun, PROBE_NAMES, VERDICT_KINDS } = (await import(
      new URL('../../scripts/lib/probe-runs.mjs', import.meta.url).href
    )) as unknown as {
      recordProbeRun: (pool: { query: ReturnType<typeof vi.fn> }, params: Record<string, unknown>) => Promise<void>
      PROBE_NAMES: Record<string, string>
      VERDICT_KINDS: Record<string, string>
    }
    const queries: Array<{ text: string; values: unknown[] }> = []
    const pool = {
      query: vi.fn(async (text: string, values: unknown[]) => {
        queries.push({ text, values })
        return { rows: [], rowCount: 1 }
      }),
    }
    await recordProbeRun(pool, {
      probeName: PROBE_NAMES.AUTH_FLOW,
      verdictKind: VERDICT_KINDS.NO_FAILURES,
    })
    expect(queries).toHaveLength(1)
    expect(queries[0].text).not.toContain('alert_audience')
    expect(queries[0].values).toHaveLength(11)
  })
})

describe('buildTeacherEmail() — privacy invariant', () => {
  it("contains only this teacher's slot IDs, never another teacher's", async () => {
    const mod = (await loadModule()) as unknown as {
      buildTeacherEmail: (
        group: {
          teacherAccountId: string
          teacherEmail: string
          slots: Array<{
            slotId: string
            startAt: string
            durationMinutes: number
            externalConflictAt: string
            conflictSourceCalendarId: string | null
            conflictSourceEventId: string | null
          }>
        },
        thresholds: { thresholdMinutes: number },
      ) => { subject: string; text: string }
    }
    const group = {
      teacherAccountId: 't1',
      teacherEmail: 'self@example.com',
      slots: [
        {
          slotId: 'slot-OWN-A',
          startAt: '2026-06-04T10:00:00.000Z',
          durationMinutes: 60,
          externalConflictAt: '2026-06-04T08:00:00.000Z',
          conflictSourceCalendarId: 'cal-own',
          conflictSourceEventId: 'ev-own',
        },
      ],
    }
    const { subject, text } = mod.buildTeacherEmail(group, { thresholdMinutes: 120 })
    expect(subject).toContain('1 нерешённый конфликт')
    expect(text).toContain('slot-OWN-A')
    // Negative assertion: nothing about other teachers leaks in.
    expect(text).not.toMatch(/other@example\.com/)
    expect(text).not.toMatch(/slot-OTHER-/)
    // The teacher's own email is the recipient — it should NOT appear
    // verbatim in the body (the body addresses them by «у вас»).
    expect(text).not.toContain('self@example.com')
    // Admin-only deep-link must NOT appear in teacher email.
    expect(text).not.toContain('/admin/accounts/')
  })
})
