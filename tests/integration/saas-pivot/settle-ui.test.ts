import { describe, expect, it } from 'vitest'

import { getDbPool } from '@/lib/db/pool'
import { markLessonCompleted } from '@/lib/teacher-ledger/mark-lesson-completed'
import {
  SettleLessonsError,
  settleLessons,
} from '@/lib/teacher-ledger/settle-lessons'

import { freshAccount, freshPastBookedSlot } from './_lesson-helpers'
import '../setup'

// SAAS-PIVOT Epic 5B Day 5B — settleLessons integration coverage.
//
// Plan: docs/plans/saas-pivot-master.md §5 Day 5B + §2.6 + Epic 5.
//
// settleLessons (lib/teacher-ledger/settle-lessons.ts) is the helper
// the new /api/teacher/learners/[id]/settle route delegates to. The
// route layer also enforces session + roster + body-validation; this
// spec covers the helper's contract end-to-end against Postgres so the
// route layer can trust its semantics:
//
//   - explicit completionIds → only those rows covered.
//   - no completionIds → FIFO oldest-first.
//   - partial amount → drain oldest first; second call drains next.
//   - anti-spoof: teacher A cannot settle teacher B's completions.
//   - anti-spoof: teacher cannot settle for a learner whose slots
//     belong to a different teacher (the helper's WHERE clause
//     already filters by teacher_id; this test pins the contract).

async function mark(
  slotId: string,
  teacherId: string,
): Promise<{ completionId: string }> {
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const r = await markLessonCompleted(client, {
      slotId,
      teacherId,
      wasNoShow: false,
      markedByAccountId: teacherId,
    })
    await client.query('commit')
    return { completionId: r.completionId }
  } finally {
    client.release()
  }
}

async function makeNCompletions(
  teacherId: string,
  learnerId: string,
  n: number,
  amountKopecks: number = 150000,
): Promise<string[]> {
  // Order matters: we need lc.created_at ascending so the FIFO walk
  // sees them in a stable order. `freshPastBookedSlot` + immediate
  // `mark` writes lesson_completions.created_at = now(); sleep a tick
  // between marks so created_at strictly orders. Postgres timestamp
  // resolution is sub-ms but JS Date.now() chunks at ms, and the
  // INSERT default `now()` reads statement start time — so back-to-
  // back inserts in one statement get the same ts. We use sequential
  // awaits with 5ms spacing.
  const ids: string[] = []
  for (let i = 0; i < n; i += 1) {
    const slotId = await freshPastBookedSlot(teacherId, learnerId, amountKopecks)
    const r = await mark(slotId, teacherId)
    ids.push(r.completionId)
    // 5ms gap so created_at strictly increases.
    await new Promise((res) => setTimeout(res, 5))
  }
  return ids
}

async function readCoverage(completionId: string): Promise<number> {
  const r = await getDbPool().query<{ covered: string }>(
    `select coalesce(sum(amount_kopecks), 0)::text as covered
       from lesson_settlement_completions
      where completion_id = $1`,
    [completionId],
  )
  return Number(r.rows[0].covered)
}

describe('SAAS-PIVOT Day 5B — settleLessons contract', () => {
  it('explicit completionIds: covers exactly those, FIFO inside the set', async () => {
    const teacherId = await freshAccount('5b-stl-explicit-teacher')
    const learnerId = await freshAccount('5b-stl-explicit-learner')
    const completionIds = await makeNCompletions(teacherId, learnerId, 3)
    // Pick the 1st and 3rd; the 2nd must stay outstanding.
    const explicit = [completionIds[0], completionIds[2]]
    const result = await settleLessons({
      learnerId,
      teacherId,
      amountKopecks: 300000, // exactly 2 × 150_000
      completionIds: explicit,
      markedByAccountId: teacherId,
    })
    expect(result.allocatedKopecks).toBe(300000)
    expect(result.unallocatedKopecks).toBe(0)
    expect(new Set(result.coveredCompletionIds)).toEqual(new Set(explicit))

    expect(await readCoverage(completionIds[0])).toBe(150000)
    expect(await readCoverage(completionIds[1])).toBe(0) // not in set
    expect(await readCoverage(completionIds[2])).toBe(150000)
  })

  it('no completionIds: FIFO covers oldest first', async () => {
    const teacherId = await freshAccount('5b-stl-fifo-teacher')
    const learnerId = await freshAccount('5b-stl-fifo-learner')
    const completionIds = await makeNCompletions(teacherId, learnerId, 3)
    // Pay exactly 2 lessons' worth — should cover #1 and #2, leave #3.
    const result = await settleLessons({
      learnerId,
      teacherId,
      amountKopecks: 300000,
      markedByAccountId: teacherId,
    })
    expect(result.allocatedKopecks).toBe(300000)
    expect(result.unallocatedKopecks).toBe(0)
    expect(result.coveredCompletionIds).toEqual([
      completionIds[0],
      completionIds[1],
    ])

    expect(await readCoverage(completionIds[0])).toBe(150000)
    expect(await readCoverage(completionIds[1])).toBe(150000)
    expect(await readCoverage(completionIds[2])).toBe(0)
  })

  it('partial sum: 50% of debt drains oldest first until exhausted', async () => {
    const teacherId = await freshAccount('5b-stl-partial-teacher')
    const learnerId = await freshAccount('5b-stl-partial-learner')
    const completionIds = await makeNCompletions(teacherId, learnerId, 4)
    // 4 × 150_000 = 600_000 total debt. Pay 50% = 300_000.
    const result = await settleLessons({
      learnerId,
      teacherId,
      amountKopecks: 300000,
      markedByAccountId: teacherId,
    })
    expect(result.allocatedKopecks).toBe(300000)
    expect(result.unallocatedKopecks).toBe(0)
    // First two completions fully paid; third + fourth untouched.
    expect(result.coveredCompletionIds).toEqual([
      completionIds[0],
      completionIds[1],
    ])
    expect(await readCoverage(completionIds[0])).toBe(150000)
    expect(await readCoverage(completionIds[1])).toBe(150000)
    expect(await readCoverage(completionIds[2])).toBe(0)
    expect(await readCoverage(completionIds[3])).toBe(0)

    // Now pay another 50%; remaining two should fill up.
    const second = await settleLessons({
      learnerId,
      teacherId,
      amountKopecks: 300000,
      markedByAccountId: teacherId,
    })
    expect(second.allocatedKopecks).toBe(300000)
    expect(second.coveredCompletionIds).toEqual([
      completionIds[2],
      completionIds[3],
    ])
    expect(await readCoverage(completionIds[2])).toBe(150000)
    expect(await readCoverage(completionIds[3])).toBe(150000)
  })

  it('partial-of-one: pay less than one lesson → only that lesson partial', async () => {
    const teacherId = await freshAccount('5b-stl-partial1-teacher')
    const learnerId = await freshAccount('5b-stl-partial1-learner')
    const completionIds = await makeNCompletions(teacherId, learnerId, 2)
    // Pay 50_000 (1/3 of one lesson).
    const result = await settleLessons({
      learnerId,
      teacherId,
      amountKopecks: 50000,
      markedByAccountId: teacherId,
    })
    expect(result.allocatedKopecks).toBe(50000)
    expect(result.unallocatedKopecks).toBe(0)
    expect(result.coveredCompletionIds).toEqual([completionIds[0]])
    expect(await readCoverage(completionIds[0])).toBe(50000)
    expect(await readCoverage(completionIds[1])).toBe(0)

    // Outstanding for completion #0 = 150_000 - 50_000 = 100_000.
    // A second partial call should top it up before touching #1.
    const second = await settleLessons({
      learnerId,
      teacherId,
      amountKopecks: 250000,
      markedByAccountId: teacherId,
    })
    expect(second.allocatedKopecks).toBe(250000)
    expect(second.coveredCompletionIds).toEqual([
      completionIds[0],
      completionIds[1],
    ])
    expect(await readCoverage(completionIds[0])).toBe(150000)
    expect(await readCoverage(completionIds[1])).toBe(150000)
  })

  it('anti-spoof: teacher A cannot settle teacher B completions via explicit IDs', async () => {
    const teacherA = await freshAccount('5b-stl-spoof-A-teacher')
    const teacherB = await freshAccount('5b-stl-spoof-B-teacher')
    const learner = await freshAccount('5b-stl-spoof-learner')
    // Teacher B owns the completion (their slot, their mark).
    const slotBId = await freshPastBookedSlot(teacherB, learner)
    const completionB = (await mark(slotBId, teacherB)).completionId
    // Teacher A tries to pretend to settle teacher B's completion.
    await expect(
      settleLessons({
        learnerId: learner,
        teacherId: teacherA,
        amountKopecks: 150000,
        completionIds: [completionB],
        markedByAccountId: teacherA,
      }),
    ).rejects.toThrow(SettleLessonsError)
    // No settlement row for teacher A.
    const settlementCount = await getDbPool().query<{ c: string }>(
      `select count(*)::text as c from lesson_settlements where teacher_id = $1`,
      [teacherA],
    )
    expect(Number(settlementCount.rows[0].c)).toBe(0)
    expect(await readCoverage(completionB)).toBe(0)
  })

  it('anti-spoof: teacher cannot FIFO-settle for a learner not in their links (no candidates → empty allocation)', async () => {
    const teacherA = await freshAccount('5b-stl-foreign-A-teacher')
    const teacherB = await freshAccount('5b-stl-foreign-B-teacher')
    const learner = await freshAccount('5b-stl-foreign-learner')
    // Learner has completions ONLY with teacher B.
    await makeNCompletions(teacherB, learner, 2)
    // Teacher A FIFO-settles for this learner — there's no
    // (teacher_id = A, learner_id = learner) completion, so the
    // candidate set is empty. The helper still inserts a settlement
    // row (operator could have over-applied money), but
    // allocatedKopecks should be 0 and unallocatedKopecks should be
    // the full amount.
    const result = await settleLessons({
      learnerId: learner,
      teacherId: teacherA,
      amountKopecks: 500000,
      markedByAccountId: teacherA,
    })
    expect(result.allocatedKopecks).toBe(0)
    expect(result.unallocatedKopecks).toBe(500000)
    expect(result.coveredCompletionIds).toEqual([])
    // Teacher B's completions untouched.
    const coverageB = await getDbPool().query<{ covered: string }>(
      `select coalesce(sum(lsc.amount_kopecks), 0)::text as covered
         from lesson_settlement_completions lsc
         join lesson_completions lc on lc.id = lsc.completion_id
        where lc.teacher_id = $1`,
      [teacherB],
    )
    expect(Number(coverageB.rows[0].covered)).toBe(0)
  })

  it('invalid amount (≤0, NaN, non-integer) → SettleLessonsError(invalid_amount)', async () => {
    const teacherId = await freshAccount('5b-stl-invamt-teacher')
    const learnerId = await freshAccount('5b-stl-invamt-learner')
    await makeNCompletions(teacherId, learnerId, 1)
    for (const bad of [0, -100, 1.5, Number.NaN]) {
      await expect(
        settleLessons({
          learnerId,
          teacherId,
          amountKopecks: bad as number,
        }),
      ).rejects.toThrow(SettleLessonsError)
    }
  })
})
