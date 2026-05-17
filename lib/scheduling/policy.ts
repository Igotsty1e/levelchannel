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
