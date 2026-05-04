#!/usr/bin/env node
//
// Phase 5 — daily auto-complete cron. Flips every still-`booked`
// lesson_slots row whose start_at + duration_minutes is in the past
// to `completed`, stamps marked_at, and prepends a
// 'slot.completed' event to the row's events log.
//
// Why daily and not hourly:
//   - Operator usually marks lessons within a few hours after they
//     happen via /admin/slots's «Прошёл» / «Не пришёл» buttons.
//   - Daily fires once at 03:30 UTC (06:30 MSK) — late enough that
//     yesterday's last lesson is comfortably finished, early enough
//     that the operator sees a fresh "yesterday's lessons completed"
//     view in the morning.
//   - Operator overrides land in `completed` / `no_show_*` first,
//     which moves status away from 'booked', so the WHERE clause
//     skips them naturally — no race / clobber.
//
// Idempotent: rerunning the same minute is a no-op (the WHERE matches
// nothing). Safe to use Persistent=true on the systemd timer.

import pg from 'pg'

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

async function main() {
  if (!process.env.DATABASE_URL) {
    logJson('error', 'DATABASE_URL not set; aborting')
    process.exit(2)
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  })

  try {
    const event = JSON.stringify([
      {
        type: 'slot.completed',
        at: new Date().toISOString(),
        actor: 'system',
        payload: { source: 'auto-complete' },
      },
    ])
    const result = await pool.query(
      `update lesson_slots
          set status = 'completed',
              marked_at = now(),
              updated_at = now(),
              events = $1::jsonb || events
        where status = 'booked'
          and start_at + (duration_minutes || ' minutes')::interval <= now()`,
      [event],
    )
    logJson('info', 'done', { completed: result.rowCount ?? 0 })
  } catch (err) {
    logJson('error', 'failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  logJson('error', 'unhandled', {
    error: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
