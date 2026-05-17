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

  it('every scope is a known probe name', () => {
    const validScopes = new Set([
      'auth-flow',
      'calendar-pathology',
      'webhook-flow',
    ])
    for (const [key, schema] of Object.entries(TS_SCHEMA)) {
      expect(validScopes.has(schema.scope), `${key}.scope is valid`).toBe(true)
    }
  })

  it('all three probes have at least one knob', () => {
    const probes = new Set(Object.values(TS_SCHEMA).map((s) => s.scope))
    expect(probes).toContain('auth-flow')
    expect(probes).toContain('calendar-pathology')
    expect(probes).toContain('webhook-flow')
  })
})
