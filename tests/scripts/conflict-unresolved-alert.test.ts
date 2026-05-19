import { describe, expect, it } from 'vitest'

// BCS-DEF-1 Phase 2 (2026-05-19) — unit tests for the probe's pure
// helpers. `scripts/conflict-unresolved-alert.mjs` exports
// `fingerprint`, `buildEmail`, `readOffenderRows`, `readOffenderCounts`,
// `readPerTeacherOmittedCounts` as named exports so this test can
// import them without invoking `main()` (the `if (invokedDirectly)
// { main() }` guard at the bottom keeps the file safe to import).
//
// The DB-touching readers are covered by an integration test (next
// sub-PR). This file pins the pure-function contracts: fingerprint
// determinism + sensitivity, plus the email body shape.

// Dynamic import keeps vitest's TypeScript transform from choking on
// the .mjs module before runtime — same pattern used by the existing
// `tests/admin/operator-settings.test.ts` to load the .mjs mirror.
const moduleUrl = new URL(
  '../../scripts/conflict-unresolved-alert.mjs',
  import.meta.url,
).href

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
