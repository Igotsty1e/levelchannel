// SAAS-PIVOT Epic 5B Day 5B — shared test helpers for lesson_completions.
//
// freshAccount / freshPastBookedSlot were duplicated in
// tests/integration/saas-pivot/lesson-completions.test.ts (Day 5A);
// Day 5B introduces two more spec files (cancel-after-uncomplete,
// settle-ui) that need the same primitives. Extract here so a future
// change to the slot-fixture pattern is one-spot. Day 5A's spec can
// be migrated to use these in a follow-up doc-sync wave; not in scope
// here to avoid touching the Day-5A-owned spec file.

import { getDbPool } from '@/lib/db/pool'

// Monotonically-decreasing counter for freshPastBookedSlot. Each call
// yields a STRICTLY LATER past `start_at` than the previous one, so
// downstream FIFO walks (`order by completed_at asc`) see a stable
// order matching the call sequence. Starts at 60 days back and steps
// down by 1 day per call — supports up to ~58 inserts per test file
// before colliding with `now()`.
let pastSlotCounter = 60
export function freshPastSlotDaysBackCounter(): number {
  const v = pastSlotCounter
  pastSlotCounter -= 1
  if (pastSlotCounter < 2) pastSlotCounter = 60 // wrap (no test ships > 50 slots)
  return v
}

export async function freshAccount(prefix: string): Promise<string> {
  const email =
    `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase()
  const result = await getDbPool().query<{ id: string }>(
    `insert into accounts (email, password_hash)
     values ($1, 'fake-hash-for-test')
     returning id`,
    [email],
  )
  return result.rows[0].id
}

// Insert a booked, past-ended lesson_slot for the (teacher, learner)
// pair. The CHECK constraint on lesson_slots.start_at refuses past
// values on INSERT AND UPDATE, so we land the new start_at inside the
// MSK 06-22 business band on a 30-min boundary. See the parallel
// helper in lesson-completions.test.ts for the design notes.
export async function freshPastBookedSlot(
  teacherId: string,
  learnerId: string,
  tariffAmountKopecks: number = 150000,
): Promise<string> {
  const pool = getDbPool()
  // pricing_tariffs.teacher_id is NOT NULL after mig 0088 (Day 3). The
  // owning teacher is the same one whose slot we're about to insert.
  const tariff = await pool.query<{ id: string }>(
    `insert into pricing_tariffs
       (teacher_id, slug, title_ru, amount_kopecks, duration_minutes)
     values ($1, 'saas5b-' || floor(random()*1e9)::text,
             'SaaS-5B test tariff', $2, 60)
     returning id`,
    [teacherId, tariffAmountKopecks],
  )
  // Anchor a fresh future slot inside the MSK 06-22 band to get past
  // the INSERT-time CHECK.
  const today = new Date()
  const slotMsk = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + 7,
      3 + Math.floor(Math.random() * 16),
      Math.random() < 0.5 ? 0 : 30,
      0,
      0,
    ),
  )
  const inserted = await pool.query<{ id: string }>(
    `insert into lesson_slots
       (teacher_account_id, start_at, duration_minutes, status,
        learner_account_id, booked_at, tariff_id)
     values ($1, $2, 60, 'booked', $3, now(), $4)
     returning id`,
    [teacherId, slotMsk.toISOString(), learnerId, tariff.rows[0].id],
  )
  // Backdate inside the band. daysBack uses a monotonically-decreasing
  // counter so each subsequent call yields a STRICTLY LATER past slot
  // (later `start_at` → later `completed_at`). FIFO walks downstream
  // see a stable order matching the call sequence.
  const daysBack = freshPastSlotDaysBackCounter()
  const hourMsk = 6 + Math.floor(Math.random() * 15) // 06..20 MSK
  const minute = Math.random() < 0.5 ? 0 : 30
  const anchor = new Date()
  anchor.setUTCDate(anchor.getUTCDate() - daysBack)
  // MSK hour H = UTC hour H-3 (MSK is UTC+3, no DST).
  const pastUtc = new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth(),
      anchor.getUTCDate(),
      hourMsk - 3,
      minute,
      0,
      0,
    ),
  )
  await pool.query(
    `update lesson_slots set start_at = $2, duration_minutes = 60 where id = $1`,
    [inserted.rows[0].id, pastUtc.toISOString()],
  )
  return inserted.rows[0].id
}

// Link the learner to the teacher so `/teacher/learners/[id]` and
// /api/teacher/learners/[id]/settle pass their roster guards.
export async function linkLearnerToTeacher(
  learnerId: string,
  teacherId: string,
): Promise<void> {
  await getDbPool().query(
    `insert into learner_teacher_links (learner_account_id, teacher_account_id)
     values ($1, $2)
     on conflict (learner_account_id, teacher_account_id) do update
        set unlinked_at = null`,
    [learnerId, teacherId],
  )
}
