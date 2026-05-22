// SAAS-PIVOT Epic 5A Day 5A — settleLessons helper.
//
// Plan: docs/plans/saas-pivot-master.md §2.6 + Epic 5.
//
// Partial or full settlement of a learner's outstanding completions
// for a single teacher. Accepts:
//   - amountKopecks — total money the learner just paid (or the
//     operator/teacher acknowledged was paid off-platform).
//   - completionIds — optional explicit set. If omitted, the helper
//     walks the learner's outstanding completions FIFO (oldest first)
//     and allocates from the amount budget.
//
// Allocation algorithm:
//   - For each candidate completion, compute the running coverage
//     (sum of existing lesson_settlement_completions.amount_kopecks).
//   - Remaining = max(0, completion.amount_kopecks - covered).
//   - Take min(remaining, budget). If positive, record an allocation
//     row + drain budget. Stop when budget == 0 or the set is
//     exhausted.
//   - lesson_settlements.amount_kopecks is the FULL amount the learner
//     paid; coverage rows sum to <= settlement.amount_kopecks (the
//     remainder, if any, becomes "overpayment" — kept on the
//     settlement row but unallocated).

import type { PoolClient } from 'pg'

import { getDbPool } from '@/lib/db/pool'

export type SettleLessonsParams = {
  learnerId: string
  teacherId: string
  amountKopecks: number
  completionIds?: string[]
  markedByAccountId?: string | null
}

export type SettleLessonsResult = {
  settlementId: string
  coveredCompletionIds: string[]
  allocatedKopecks: number
  unallocatedKopecks: number
}

export class SettleLessonsError extends Error {
  public readonly reason:
    | 'invalid_amount'
    | 'unknown_completion'
    | 'completion_not_eligible'

  constructor(
    reason:
      | 'invalid_amount'
      | 'unknown_completion'
      | 'completion_not_eligible',
    detail?: string,
  ) {
    super(
      detail ? `settle_lessons/${reason}/${detail}` : `settle_lessons/${reason}`,
    )
    this.name = 'SettleLessonsError'
    this.reason = reason
  }
}

export async function settleLessons(
  params: SettleLessonsParams,
): Promise<SettleLessonsResult> {
  if (
    !Number.isFinite(params.amountKopecks) ||
    params.amountKopecks <= 0 ||
    !Number.isInteger(params.amountKopecks)
  ) {
    throw new SettleLessonsError('invalid_amount')
  }
  const pool = getDbPool()
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await settleLessonsInTx(client, params)
    await client.query('commit')
    return result
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// Caller-owned-tx variant for tests / composed flows.
export async function settleLessonsInTx(
  client: PoolClient,
  params: SettleLessonsParams,
): Promise<SettleLessonsResult> {
  // Candidate completions — outstanding ones for this learner × teacher.
  // "Outstanding" = completion.amount_kopecks > sum(coverage). Read
  // with FOR UPDATE so concurrent settle calls serialise per completion.
  const where = params.completionIds && params.completionIds.length > 0
    ? `and lc.id = any($3::uuid[])`
    : ''
  const args: unknown[] = [params.teacherId]
  // Restrict to completions for slots whose learner_account_id matches.
  // lesson_completions does not carry learner_account_id directly; join
  // through lesson_slots.
  const sql = `
    select lc.id,
           lc.amount_kopecks,
           coalesce(sum(lsc.amount_kopecks), 0)::int as covered
      from lesson_completions lc
      join lesson_slots s on s.id = lc.slot_id
      left join lesson_settlement_completions lsc
             on lsc.completion_id = lc.id
     where lc.teacher_id = $1
       and s.learner_account_id = $2
       ${where}
     group by lc.id, lc.amount_kopecks, lc.created_at
    having coalesce(sum(lsc.amount_kopecks), 0) < lc.amount_kopecks
     order by lc.created_at asc, lc.id asc
     for update of lc
  `
  args.push(params.learnerId)
  if (params.completionIds && params.completionIds.length > 0) {
    args.push(params.completionIds)
  }
  const candidates = await client.query(sql, args)

  // If caller passed explicit completionIds, validate every one exists
  // and is outstanding.
  if (params.completionIds && params.completionIds.length > 0) {
    const foundIds = new Set(candidates.rows.map((r) => String(r.id)))
    for (const id of params.completionIds) {
      if (!foundIds.has(id)) {
        throw new SettleLessonsError('completion_not_eligible', id)
      }
    }
  }

  // Insert settlement row.
  const settlement = await client.query(
    `insert into lesson_settlements
       (learner_account_id, teacher_id, amount_kopecks, marked_by_account_id)
     values ($1, $2, $3, $4)
     returning id`,
    [
      params.learnerId,
      params.teacherId,
      params.amountKopecks,
      params.markedByAccountId ?? null,
    ],
  )
  const settlementId = String(settlement.rows[0].id)

  let budget = params.amountKopecks
  const coveredCompletionIds: string[] = []
  for (const row of candidates.rows) {
    if (budget <= 0) break
    const completionId = String(row.id)
    const amount = Number(row.amount_kopecks)
    const covered = Number(row.covered)
    const remaining = Math.max(0, amount - covered)
    if (remaining <= 0) continue
    const allocation = Math.min(remaining, budget)
    if (allocation <= 0) continue
    await client.query(
      `insert into lesson_settlement_completions
         (settlement_id, completion_id, amount_kopecks)
       values ($1, $2, $3)
       on conflict (settlement_id, completion_id) do update
          set amount_kopecks = lesson_settlement_completions.amount_kopecks + excluded.amount_kopecks`,
      [settlementId, completionId, allocation],
    )
    coveredCompletionIds.push(completionId)
    budget -= allocation
  }

  const allocatedKopecks = params.amountKopecks - budget
  return {
    settlementId,
    coveredCompletionIds,
    allocatedKopecks,
    unallocatedKopecks: budget,
  }
}
