import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { pluralRu } from '@/lib/copy/plural-ru'

// BCS-DEF-5 (2026-05-19) — extracted from inlined helper in
// scripts/conflict-unresolved-alert.mjs. Plan: docs/plans/
// bcs-def-5-teacher-reminders.md §3.5.

describe('pluralRu — Russian plural rules', () => {
  it('1 → singular', () => {
    expect(pluralRu(1, 'занятие', 'занятия', 'занятий')).toBe('занятие')
  })
  it('2, 3, 4 → few', () => {
    expect(pluralRu(2, 'занятие', 'занятия', 'занятий')).toBe('занятия')
    expect(pluralRu(3, 'занятие', 'занятия', 'занятий')).toBe('занятия')
    expect(pluralRu(4, 'занятие', 'занятия', 'занятий')).toBe('занятия')
  })
  it('5, 6, 7, 8, 9, 0 → many', () => {
    for (const n of [0, 5, 6, 7, 8, 9]) {
      expect(pluralRu(n, 'занятие', 'занятия', 'занятий')).toBe('занятий')
    }
  })
  it('mod-100 edge: 11, 12, 13, 14 → many (NOT singular/few)', () => {
    for (const n of [11, 12, 13, 14]) {
      expect(pluralRu(n, 'занятие', 'занятия', 'занятий')).toBe('занятий')
    }
  })
  it('21 → singular (mod-10=1, mod-100=21≠11)', () => {
    expect(pluralRu(21, 'занятие', 'занятия', 'занятий')).toBe('занятие')
  })
  it('22, 23, 24 → few', () => {
    for (const n of [22, 23, 24]) {
      expect(pluralRu(n, 'занятие', 'занятия', 'занятий')).toBe('занятия')
    }
  })
  it('25, 26, 27, 28, 29, 30 → many', () => {
    for (const n of [25, 26, 27, 28, 29, 30]) {
      expect(pluralRu(n, 'занятие', 'занятия', 'занятий')).toBe('занятий')
    }
  })
  it('111, 112, 113, 114 → many (>100 mod-100 edge)', () => {
    for (const n of [111, 112, 113, 114]) {
      expect(pluralRu(n, 'занятие', 'занятия', 'занятий')).toBe('занятий')
    }
  })
  it('101 → singular (mod-100=1)', () => {
    expect(pluralRu(101, 'занятие', 'занятия', 'занятий')).toBe('занятие')
  })
})

describe('TS ↔ mjs drift pin', () => {
  it('produces identical output for 0-100 across 3 noun triples', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const mjsPath = resolvePath(here, '../../scripts/lib/plural-ru.mjs')
    const mod = (await import(mjsPath)) as {
      pluralRu: (n: number, one: string, few: string, many: string) => string
    }
    const triples: Array<[string, string, string]> = [
      ['занятие', 'занятия', 'занятий'],
      ['учитель', 'учителя', 'учителей'],
      ['конфликт', 'конфликта', 'конфликтов'],
    ]
    for (const [one, few, many] of triples) {
      for (let n = 0; n <= 100; n++) {
        expect(mod.pluralRu(n, one, few, many)).toBe(
          pluralRu(n, one, few, many),
        )
      }
    }
  })
})
