// Code-quality audit 2026-06-02 F9 — shared SQL fragment for the
// read-side "active integration with fresh pull" gate.
//
// Centralises the predicate previously inlined 4× across
// `lib/scheduling/slots/booking.ts` (BUSY_OVERLAP_GATE_SQL +
// post-failure overlap probe) and `lib/calendar/hidden-slots.ts`
// (listHiddenSlotsForTeacher + countHiddenSlotsForTeacher). The JS
// sibling lives in `lib/calendar/derive-status.ts` as
// `PULL_FRESHNESS_TTL_MS = 10 * 60 * 1000`.
//
// ============================================================
// CRITICAL — read before touching:
// ============================================================
//   1. This is a STRING CONSTANT, NOT prepared-statement input.
//      Interpolate it into a SQL template literal alongside other
//      static fragments. Do NOT pass it as a `$N` bind parameter
//      and do NOT try to parameterise the interval — `pg` would
//      treat it as a literal string in the SQL, breaking the gate.
//   2. The constant assumes the calling SQL has joined or aliased
//      `teacher_calendar_integrations` as `tci`. All 4 call sites
//      do; any new call site MUST do the same.
//   3. READ-SIDE ONLY. The write-side lifecycle SQL in
//      `lib/calendar/integrations.ts:208-219` (reconnect: sets
//      `sync_state='active'`, `last_pulled_at=null`) and
//      `lib/calendar/pull-runner.ts:337-356` (`IS NOT DISTINCT
//      FROM` guard on token-write) is INTENTIONALLY excluded —
//      those rows manage `last_pulled_at`/`sync_state` themselves
//      and have their own NULL semantics. Do NOT centralise them
//      here.
//   4. Changing this string changes the gate everywhere at once.
//      The drift test
//      `tests/calendar/freshness-sql-call-sites.test.ts` asserts
//      every known call site imports this constant rather than
//      inlining a fork.

export const ACTIVE_INTEGRATION_FRESHNESS_INTERVAL = "interval '10 minutes'"

export const ACTIVE_INTEGRATION_GATE_SQL = `tci.sync_state = 'active' and tci.last_pulled_at >= now() - ${ACTIVE_INTEGRATION_FRESHNESS_INTERVAL}`
