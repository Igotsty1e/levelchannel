import { describe, expect, it } from 'vitest'

import {
  resolveOperatorSetting,
  resolveOperatorSettingsForProbe,
} from '@/lib/admin/operator-settings'
import { getDbPool } from '@/lib/db/pool'

// BCS-DEF-1 Phase 3 (2026-05-19) — integration test for the Phase 1
// foundation. Pins:
//
//  1. probe_runs CHECK accepts 'conflict-unresolved' (migration 0058
//     applied + alerts-obs.test.ts cleanup path widened).
//  2. probe_runs CHECK rejects bogus probe_name (regression: CHECK
//     was not accidentally widened to `ANY`).
//  3. Operator-settings resolver chain DB → env → default works for
//     all 4 CONFLICT_UNRESOLVED_* keys (defaults match plan §2.3).
//  4. resolveOperatorSettingsForProbe('conflict-unresolved') returns
//     exactly the 4 keys, all with `source: 'default'` when DB is
//     empty (the canonical state on a fresh deploy).

describe('BCS-DEF-1 Phase 1 foundation', () => {
  it('probe_runs CHECK accepts "conflict-unresolved" INSERT', async () => {
    const pool = getDbPool()
    const insert = await pool.query(
      `insert into probe_runs (probe_name, verdict_kind, is_test)
       values ($1, $2, true)
       returning id`,
      ['conflict-unresolved', 'no_offenders'],
    )
    expect(insert.rows.length).toBe(1)
    // Cleanup so the row doesn't pollute the "last run" indexes used
    // by /admin/settings/alerts.
    await pool.query(`delete from probe_runs where id = $1`, [
      insert.rows[0].id,
    ])
  })

  it('probe_runs CHECK rejects bogus probe_name', async () => {
    const pool = getDbPool()
    await expect(
      pool.query(
        `insert into probe_runs (probe_name, verdict_kind, is_test)
         values ($1, $2, true)`,
        ['bogus-probe-not-in-enum', 'ok'],
      ),
    ).rejects.toThrow(/probe_runs_probe_name_check|violates check constraint/i)
  })

  it('resolveOperatorSetting() returns plan defaults for the 4 CONFLICT_UNRESOLVED_* keys', async () => {
    const threshold = await resolveOperatorSetting(
      'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
      {},
    )
    expect(threshold.value).toBe(120)
    expect(threshold.source).toBe('default')

    const reportLimit = await resolveOperatorSetting(
      'CONFLICT_UNRESOLVED_REPORT_LIMIT',
      {},
    )
    expect(reportLimit.value).toBe(50)
    expect(reportLimit.source).toBe('default')

    const perTeacherLimit = await resolveOperatorSetting(
      'CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT',
      {},
    )
    expect(perTeacherLimit.value).toBe(5)
    expect(perTeacherLimit.source).toBe('default')

    const dedupWindow = await resolveOperatorSetting(
      'CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS',
      {},
    )
    expect(dedupWindow.value).toBe(4 * 3600 * 1000)
    expect(dedupWindow.source).toBe('default')
  })

  it('resolveOperatorSettingsForProbe("conflict-unresolved") returns exactly 4 keys', async () => {
    const snap = await resolveOperatorSettingsForProbe(
      'conflict-unresolved',
      {},
    )
    const keys = Object.keys(snap).sort()
    expect(keys).toEqual([
      'CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS',
      'CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT',
      'CONFLICT_UNRESOLVED_REPORT_LIMIT',
      'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
    ])
    // Source is `default` on a fresh DB (no operator_settings rows
    // for these keys yet). Env overrides exhaustively tested in the
    // sibling resolver tests.
    for (const key of keys) {
      expect(snap[key].source).toBe('default')
    }
  })

  it('env override flows through to source=env for CONFLICT_UNRESOLVED_THRESHOLD_MINUTES', async () => {
    const r = await resolveOperatorSetting(
      'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
      { CONFLICT_UNRESOLVED_THRESHOLD_MINUTES: '60' },
    )
    expect(r.value).toBe(60)
    expect(r.source).toBe('env')
  })

  it('env override out-of-bounds falls back to default', async () => {
    // max=1440; 9999 is out of range → resolver rejects and falls
    // back to default (120 min) per the validator contract.
    const r = await resolveOperatorSetting(
      'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
      { CONFLICT_UNRESOLVED_THRESHOLD_MINUTES: '9999' },
    )
    expect(r.value).toBe(120)
    expect(r.source).toBe('default')
  })
})
