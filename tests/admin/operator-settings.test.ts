import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SETTING_SCHEMA as TS_SCHEMA,
} from '@/lib/admin/operator-settings'

// ALERTS-EDITOR Sub-PR A (2026-05-17) — schema drift test.
// The TS schema in `lib/admin/operator-settings.ts` and the JS mirror
// in `scripts/lib/operator-settings.mjs` MUST stay structurally
// identical. The probe scripts read the mjs file; the /admin UI +
// route reads the TS file. Drift = silent regression where a key
// edited in /admin doesn't actually flow through the probe.

describe('SETTING_SCHEMA drift TS ↔ MJS', () => {
  it('TS keys, kinds, defaults, mins/maxs, env names match the MJS mirror', async () => {
    // Dynamic import so vitest doesn't crash on the .mjs at parse
    // time — we want the actual structure that the probe scripts
    // will see at runtime.
    const here = dirname(fileURLToPath(import.meta.url))
    const mjsPath = resolvePath(here, '../../scripts/lib/operator-settings.mjs')
    // Loads through the actual module path.
    const mod = (await import(mjsPath)) as {
      SETTING_SCHEMA: Record<string, unknown>
    }
    expect(JSON.stringify(mod.SETTING_SCHEMA)).toBe(JSON.stringify(TS_SCHEMA))
  })

  it('TS and MJS files are not symlinks of each other', () => {
    // Sanity: the test could pass if someone symlinked the files
    // and broke the import. Both files must contain the literal
    // TS / JS markers.
    const here = dirname(fileURLToPath(import.meta.url))
    const tsBody = readFileSync(
      resolvePath(here, '../../lib/admin/operator-settings.ts'),
      'utf-8',
    )
    const mjsBody = readFileSync(
      resolvePath(here, '../../scripts/lib/operator-settings.mjs'),
      'utf-8',
    )
    expect(tsBody).toContain('as const satisfies Record<string, SettingSchema>')
    expect(mjsBody).toContain('Object.freeze')
  })
})

describe('SETTING_SCHEMA invariants', () => {
  it('every entry has min < max + sensible default within bounds', () => {
    for (const [key, schema] of Object.entries(TS_SCHEMA)) {
      expect(schema.min, `${key}.min < max`).toBeLessThan(schema.max)
      expect(schema.default, `${key}.default >= min`).toBeGreaterThanOrEqual(
        schema.min,
      )
      expect(schema.default, `${key}.default <= max`).toBeLessThanOrEqual(
        schema.max,
      )
    }
  })

  it('every entry has envName === key (operator-side bootstrap parity)', () => {
    for (const [key, schema] of Object.entries(TS_SCHEMA)) {
      expect(schema.envName, `${key}.envName matches key`).toBe(key)
    }
  })

  it('every scope is a known probe name or channel scope', () => {
    // BCS-DEF-1 Phase 1 (2026-05-19) — 'conflict-unresolved' added
    // alongside the 3 already-shipped probes. The probe script itself
    // ships in Phase 2; the schema scope is widened first so the 4
    // CONFLICT_UNRESOLVED_* keys land cleanly.
    //
    // BCS-DEF-1-TG (2026-05-19) — 'telegram' added as a CHANNEL scope
    // (not a probe). Per plan §2.5.1, channel-scope keys partition
    // disjointly from probe-scope keys; the next test pins that
    // invariant explicitly.
    //
    // BCS-DEF-4 (2026-05-19) — 'learner-reminders' added as a
    // PROBE-SHAPED scope for the lesson reminder scheduler. NOT in
    // `PROBE_NAMES` iteration (the scheduler isn't an alert probe;
    // it has no "last alert" surface), but reuses SETTING_SCHEMA for
    // the operator-tunable window + master switch + rate limit.
    const validScopes = new Set([
      'auth-flow',
      'calendar-pathology',
      'webhook-flow',
      'conflict-unresolved',
      'telegram',
      // BCS-DEF-5 (2026-05-19) — daily 08:00 teacher lesson digest.
      'teacher-daily-digest',
      // BCS-DEF-4 (2026-05-19) — learner lesson reminder scheduler.
      'learner-reminders',
    ])
    for (const [key, schema] of Object.entries(TS_SCHEMA)) {
      expect(validScopes.has(schema.scope), `${key}.scope is valid`).toBe(true)
    }
  })

  it('all four probes have at least one knob', () => {
    const probes = new Set(Object.values(TS_SCHEMA).map((s) => s.scope))
    expect(probes).toContain('auth-flow')
    expect(probes).toContain('calendar-pathology')
    expect(probes).toContain('webhook-flow')
    expect(probes).toContain('conflict-unresolved')
  })

  it('teacher-daily-digest scope has the 3 expected keys', () => {
    // BCS-DEF-5 (2026-05-19) regression pin — the digest cron's
    // resolveOperatorSettingsForProbe('teacher-daily-digest') walks
    // the schema by scope match. If a future refactor drops or
    // renames any of these, the cron silently falls back to defaults
    // (master switch OFF by default, so it stays safe — but
    // observability would suffer). Pin them.
    const digestKeys = Object.entries(TS_SCHEMA)
      .filter(([, s]) => s.scope === 'teacher-daily-digest')
      .map(([k]) => k)
      .sort()
    expect(digestKeys).toEqual([
      'TEACHER_DIGEST_MASTER_SWITCH',
      'TEACHER_DIGEST_MAX_ATTEMPTS',
      'TEACHER_DIGEST_RATE_LIMIT_PER_TICK',
    ])
  })

  it('TEACHER_DIGEST_MASTER_SWITCH defaults to OFF', () => {
    // Round-1 BLOCKER 7 closure — operator must explicitly enable in
    // /admin/settings/digest after activation; never auto-fire on
    // first deploy.
    expect(TS_SCHEMA.TEACHER_DIGEST_MASTER_SWITCH.default).toBe(0)
  })

  it('conflict-unresolved scope has the 4 expected threshold keys', () => {
    // BCS-DEF-1 Phase 1 regression pin — if a future refactor drops
    // any of these, the probe script in Phase 2 will silently fall
    // back to defaults / env, which is harder to debug than a failing
    // test here.
    const conflictKeys = Object.entries(TS_SCHEMA)
      .filter(([, s]) => s.scope === 'conflict-unresolved')
      .map(([k]) => k)
      .sort()
    expect(conflictKeys).toEqual([
      'CONFLICT_UNRESOLVED_DEDUP_WINDOW_MS',
      'CONFLICT_UNRESOLVED_PER_TEACHER_LIMIT',
      'CONFLICT_UNRESOLVED_REPORT_LIMIT',
      'CONFLICT_UNRESOLVED_THRESHOLD_MINUTES',
    ])
  })

  // BCS-DEF-1-TG (2026-05-19) — plan §2.5.1 + §3.6b + R3 INFO#6 closure.
  it('telegram scope has the 2 expected channel-wide keys', () => {
    const telegramKeys = Object.entries(TS_SCHEMA)
      .filter(([, s]) => s.scope === 'telegram')
      .map(([k]) => k)
      .sort()
    expect(telegramKeys).toEqual([
      'TELEGRAM_ALERTS_MASTER_SWITCH',
      'TELEGRAM_ALERTS_RETRY_MAX',
    ])
  })

  // BCS-DEF-4 (2026-05-19) + BCS-DEF-4-TG (2026-05-20) — learner-reminders
  // scope has 4 keys (3 scheduler knobs + 1 Telegram master switch).
  it('learner-reminders scope has the 4 expected scheduler keys', () => {
    const reminderKeys = Object.entries(TS_SCHEMA)
      .filter(([, s]) => s.scope === 'learner-reminders')
      .map(([k]) => k)
      .sort()
    expect(reminderKeys).toEqual([
      'LEARNER_REMINDERS_EMAIL_ENABLED',
      'LEARNER_REMINDERS_RATE_LIMIT_PER_TICK',
      'LEARNER_REMINDERS_TELEGRAM_ENABLED',
      'LEARNER_REMINDER_WINDOW_MINUTES',
    ])
  })

  it('channel-scope keys are DISJOINT from probe-scope keys (scope-set-based partition)', () => {
    // R3 INFO#6 closure: invariant via scope membership, NOT name
    // prefix. Future channel scopes (slack, sms) inherit automatically.
    // BCS-DEF-4: 'learner-reminders' counts as a probe-shaped scope
    // here even though it's not in the runtime `PROBE_NAMES` iteration.
    const probeNames = new Set([
      'auth-flow',
      'calendar-pathology',
      'webhook-flow',
      'conflict-unresolved',
      'learner-reminders',
    ])
    const telegramKeys = new Set(
      Object.entries(TS_SCHEMA)
        .filter(([, s]) => s.scope === 'telegram')
        .map(([k]) => k),
    )
    const probeKeys = new Set(
      Object.entries(TS_SCHEMA)
        .filter(([, s]) => probeNames.has(s.scope))
        .map(([k]) => k),
    )
    // Empty intersection.
    for (const k of telegramKeys) {
      expect(probeKeys.has(k), `${k} must not be in any probe scope`).toBe(
        false,
      )
    }
    for (const k of probeKeys) {
      expect(telegramKeys.has(k), `${k} must not be in telegram scope`).toBe(
        false,
      )
    }
  })
})
