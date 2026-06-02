import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// Bug #3 (2026-06-02) — static source pin.
//
// Original Calendly-style booking wave (BCS-B.frontend) shipped the
// h1 «Занятие по английскому» and the subline «🕒 50 мин» on
// /cabinet/book + «Длительность: 50 мин» on /cabinet/book/[ymd] as
// placeholder copy. Owner reported them as confusing — neither value
// is sourced from any tariff/slot row. Real per-slot title +
// duration come from PublicSlot (`tariffTitleRu`, `durationMinutes`)
// surfaced by /api/slots/booking-times.
//
// This test fs-reads the three live components and pins them clean.
// Regression catch: if anyone re-introduces a placeholder string
// (copy-paste from an old screenshot, dummy data while debugging),
// CI fails before merge.
//
// Scope: only the three product booking-page components, not docs,
// not tests, not offer/legal copy.

const REPO_ROOT = path.resolve(__dirname, '..', '..')

const SCREEN_1 = path.resolve(REPO_ROOT, 'app/cabinet/book/page.tsx')
const SCREEN_2 = path.resolve(REPO_ROOT, 'app/cabinet/book/[ymd]/page.tsx')
const TIME_LIST = path.resolve(
  REPO_ROOT,
  'app/cabinet/book/[ymd]/time-list.tsx',
)

function read(p: string): string {
  return readFileSync(p, 'utf-8')
}

describe('Bug #3 — no hardcoded booking copy', () => {
  it('screen 1 (/cabinet/book) does not contain placeholder literals', () => {
    const src = read(SCREEN_1)
    // Literal h1 placeholder. The fix replaces it with a generic
    // «Запись на занятие» label.
    expect(src).not.toContain('Занятие по английскому')
    // Literal duration placeholder. Word-boundary regex so a
    // legitimate occurrence of «150 мин» or «50 минут» elsewhere in
    // copy would not false-fail. The exact placeholder pattern was
    // `🕒 50 мин` / `50 мин` standalone in JSX.
    expect(src).not.toMatch(/(^|[^\d])50 мин(?!\p{L})/u)
  })

  it('screen 2 (/cabinet/book/[ymd]) does not contain placeholder literals', () => {
    const src = read(SCREEN_2)
    expect(src).not.toContain('Длительность: 50 мин')
    expect(src).not.toMatch(/(^|[^\d])50 мин(?!\p{L})/u)
  })

  it('TimeList does not contain placeholder literals', () => {
    const src = read(TIME_LIST)
    expect(src).not.toContain('Занятие по английскому')
    // 50 мин may legitimately appear in code comments (e.g. mentioning
    // legacy/historical examples). The forbidden pattern is the JSX
    // literal — bare `50 мин` outside a comment. The component as
    // shipped contains no `50 мин` substring at all (the bug fix moved
    // duration to dynamic `${slot.durationMinutes} мин`).
    expect(src).not.toMatch(/(^|[^\d])50 мин(?!\p{L})/u)
  })

  it('TimeList consumes tariffTitleRu from the public DTO', () => {
    // Smoke pin: the component must actually READ the field — without
    // it, the placeholder might be gone but the real title is also
    // missing. Match the field access pattern.
    const src = read(TIME_LIST)
    expect(src).toMatch(/tariffTitleRu/)
  })
})
