#!/usr/bin/env node
//
// SAAS-PIVOT Epic 5A Day 5A (2026-05-22) — DISABLED.
//
// Owner Q-2 (2026-05-21): teacher-manual marking only in MVP. The
// daily auto-complete cron is dark from Day 5A onwards; lesson
// completion is now driven by `markLessonCompleted()` writes that go
// through `lesson_completions` + forward trigger.
//
// We keep the script (and its systemd timer wiring) so the existing
// deploy contour continues to no-op cleanly. Returning exit 0 keeps
// the timer log green; if the cron ever needs to be re-enabled,
// restore the historical body from git (or re-write per a future
// auto-mark epic).
//
// Historical behaviour (Phase 5): flipped every still-`booked` row
// whose start_at + duration_minutes was in the past to `completed`.
// That behaviour now lives in `lesson_completions` writers (manual
// or, future, scheduled). DO NOT re-add direct status writes here —
// they bypass the unified billable-event SoT.

function logJson(level, msg, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      ts: new Date().toISOString(),
      probe: 'auto-complete-slots',
      msg,
      ...extra,
    }),
  )
}

logJson('info', 'auto-complete cron disabled per Day-5A migration', {
  disabled: true,
  reason: 'SAAS-PIVOT Owner Q-2 (manual only in MVP)',
})
process.exit(0)
