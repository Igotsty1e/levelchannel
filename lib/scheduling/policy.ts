// POLICY-KNOBS (2026-05-17) — env-tunable scheduling policy knobs.
//
// Currently exposes one knob: LEARNER_CANCEL_WINDOW_HOURS — the
// minimum hours-until-start required for a learner to cancel their
// own booking. Operator/admin paths bypass this; the gate applies
// only to the learner self-service cancel path.
//
// Contract:
//   - Reads env on EVERY call. No module-scope memoization.
//     Per-request reads are cheap (regex + int parse) and the
//     no-memoize property means operator-side `systemctl restart`
//     is the only step to roll a new policy — no stale capture in
//     long-lived workers.
//   - Default 24h preserves pre-POLICY-KNOBS behaviour exactly.
//   - Strict /^\d+$/ regex. NO trim — operator must supply a clean
//     string of digits. Any whitespace, sign, decimal, or non-digit
//     character fails the match → fallback to default 24h.
//     Examples rejected (all → 24): '0.5', '6h', '24abc', ' 24 ',
//     '+24', '24.0', '-1', 'NaN', 'Infinity', '721', ''.
//     Examples accepted: '0' (no-gate), '6', '24', '48', '720'.
//   - Range: [0..720] hours (0 = no gate; 720 = 30 days).

const DEFAULT_LEARNER_CANCEL_WINDOW_HOURS = 24
const MIN_LEARNER_CANCEL_WINDOW_HOURS = 0
const MAX_LEARNER_CANCEL_WINDOW_HOURS = 720 // 30 days; absurd-bound

const INTEGER_PATTERN = /^\d+$/

export function getLearnerCancelWindowHours(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.LEARNER_CANCEL_WINDOW_HOURS ?? ''
  if (raw.length === 0) return DEFAULT_LEARNER_CANCEL_WINDOW_HOURS
  if (!INTEGER_PATTERN.test(raw)) return DEFAULT_LEARNER_CANCEL_WINDOW_HOURS
  const parsed = Number(raw)
  if (
    !Number.isFinite(parsed)
    || !Number.isInteger(parsed)
    || parsed < MIN_LEARNER_CANCEL_WINDOW_HOURS
    || parsed > MAX_LEARNER_CANCEL_WINDOW_HOURS
  ) {
    return DEFAULT_LEARNER_CANCEL_WINDOW_HOURS
  }
  return parsed
}

export function getLearnerCancelThresholdMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return getLearnerCancelWindowHours(env) * 60 * 60 * 1000
}

// 2026-06-17 — per-teacher cancel-window в минутах.
// Migration 0132 добавила колонку accounts.teacher_cancel_window_minutes
// (default 1440 = 24h, диапазон 0..2880 = 0..48h).
// Owner-feedback: per-teacher настройка вместо глобального env.

import { getDbPool } from '@/lib/db/pool'

const DEFAULT_TEACHER_CANCEL_WINDOW_MINUTES = 1440 // 24h
const MAX_TEACHER_CANCEL_WINDOW_MINUTES = 2880 // 48h

export async function getTeacherCancelWindowMinutes(
  teacherAccountId: string,
): Promise<number> {
  try {
    const pool = getDbPool()
    const r = await pool.query<{ minutes: number | null }>(
      `select teacher_cancel_window_minutes as minutes
         from accounts where id = $1`,
      [teacherAccountId],
    )
    const m = r.rows[0]?.minutes
    if (m === null || m === undefined) return DEFAULT_TEACHER_CANCEL_WINDOW_MINUTES
    const n = Number(m)
    if (
      !Number.isFinite(n)
      || !Number.isInteger(n)
      || n < 0
      || n > MAX_TEACHER_CANCEL_WINDOW_MINUTES
    ) {
      return DEFAULT_TEACHER_CANCEL_WINDOW_MINUTES
    }
    return n
  } catch {
    return DEFAULT_TEACHER_CANCEL_WINDOW_MINUTES
  }
}

export async function setTeacherCancelWindowMinutes(
  teacherAccountId: string,
  minutes: number,
): Promise<void> {
  const clamped = Math.max(0, Math.min(MAX_TEACHER_CANCEL_WINDOW_MINUTES, Math.round(minutes)))
  const pool = getDbPool()
  await pool.query(
    `update accounts
        set teacher_cancel_window_minutes = $2
      where id = $1`,
    [teacherAccountId, clamped],
  )
}
