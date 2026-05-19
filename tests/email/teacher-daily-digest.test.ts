import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { renderTeacherDailyDigestEmail } from '@/lib/email/templates/teacher-daily-digest'

// BCS-DEF-5 (2026-05-19) — TS-mirror copy tests + TS ↔ mjs drift pin.
// Plan: docs/plans/bcs-def-5-teacher-reminders.md §3.4.

// Pick a UTC start_at that renders to a known local hour in
// Europe/Moscow (MSK, no DST, UTC+3). 06:00 UTC = 09:00 MSK.
const tz = 'Europe/Moscow'
const baseSlot = {
  startAtIso: '2026-06-01T06:00:00.000Z',
  learnerDisplayName: 'Иван П.',
  learnerEmail: 'ivan@example.com',
  zoomUrl: 'https://meet.google.com/abc-defg-hij',
}

function render(overrides: Partial<Parameters<typeof renderTeacherDailyDigestEmail>[0]>) {
  return renderTeacherDailyDigestEmail({
    teacherDisplayName: 'Анна',
    teacherTimezone: tz,
    slots: [baseSlot],
    siteUrl: 'https://levelchannel.ru',
    ...overrides,
  })
}

describe('renderTeacherDailyDigestEmail — subject pluralization', () => {
  it('1 slot → "1 занятие"', () => {
    const out = render({ slots: [baseSlot] })
    expect(out.subject).toBe('LevelChannel — 1 занятие на сегодня')
  })
  it('2 slots → "2 занятия"', () => {
    const out = render({ slots: [baseSlot, baseSlot] })
    expect(out.subject).toBe('LevelChannel — 2 занятия на сегодня')
  })
  it('5 slots → "5 занятий"', () => {
    const slots = Array(5).fill(baseSlot)
    const out = render({ slots })
    expect(out.subject).toBe('LevelChannel — 5 занятий на сегодня')
  })
  it('11 slots → "11 занятий" (mod-100 edge)', () => {
    const slots = Array(11).fill(baseSlot)
    const out = render({ slots })
    expect(out.subject).toBe('LevelChannel — 11 занятий на сегодня')
  })
  it('21 slots → "21 занятие" (mod-10=1, mod-100≠11)', () => {
    const slots = Array(21).fill(baseSlot)
    const out = render({ slots })
    expect(out.subject).toBe('LevelChannel — 21 занятие на сегодня')
  })
  it('0 slots throws (defensive guard)', () => {
    expect(() => render({ slots: [] })).toThrow(/slots\.length must be >= 1/)
  })
})

describe('renderTeacherDailyDigestEmail — greeting', () => {
  it('with displayName = Анна', () => {
    const out = render({ teacherDisplayName: 'Анна' })
    expect(out.text).toMatch(/^Здравствуйте, Анна\./)
    expect(out.html).toContain('Здравствуйте, Анна.')
  })
  it('with null displayName falls back to no-name greeting', () => {
    const out = render({ teacherDisplayName: null })
    expect(out.text).toMatch(/^Здравствуйте\./)
  })
  it('with empty displayName falls back', () => {
    const out = render({ teacherDisplayName: '   ' })
    expect(out.text).toMatch(/^Здравствуйте\./)
  })
})

describe('renderTeacherDailyDigestEmail — per-slot lines', () => {
  it('per-slot line uses displayName when set', () => {
    const out = render({
      slots: [{ ...baseSlot, learnerDisplayName: 'Иван П.' }],
    })
    expect(out.text).toContain('09:00 — учащийся Иван П.')
  })
  it('per-slot line falls back to email when displayName null', () => {
    const out = render({
      slots: [
        {
          ...baseSlot,
          learnerDisplayName: null,
          learnerEmail: 'ivan@example.com',
        },
      ],
    })
    expect(out.text).toContain('09:00 — учащийся ivan@example.com')
  })
  it('zoom URL line present when zoomUrl is set', () => {
    const out = render({ slots: [baseSlot] })
    expect(out.text).toContain('Войти: https://meet.google.com/abc-defg-hij')
  })
  it('zoom URL line OMITTED entirely when zoomUrl is null', () => {
    const out = render({
      slots: [{ ...baseSlot, zoomUrl: null }],
    })
    expect(out.text).not.toContain('Войти:')
    // No "—" placeholder either.
    expect(out.text).not.toMatch(/Войти:\s*—/)
  })
  it('chronological order is preserved', () => {
    const out = render({
      slots: [
        { ...baseSlot, startAtIso: '2026-06-01T06:00:00.000Z' }, // 09:00 MSK
        { ...baseSlot, startAtIso: '2026-06-01T08:00:00.000Z' }, // 11:00 MSK
        { ...baseSlot, startAtIso: '2026-06-01T11:30:00.000Z' }, // 14:30 MSK
      ],
    })
    const idx09 = out.text.indexOf('09:00')
    const idx11 = out.text.indexOf('11:00')
    const idx1430 = out.text.indexOf('14:30')
    expect(idx09).toBeGreaterThan(0)
    expect(idx11).toBeGreaterThan(idx09)
    expect(idx1430).toBeGreaterThan(idx11)
  })
})

describe('renderTeacherDailyDigestEmail — escapeHtml on dynamic fields', () => {
  it('teacher displayName html-escaped', () => {
    const out = render({ teacherDisplayName: '<Анна>' })
    expect(out.html).toContain('&lt;Анна&gt;')
    // plain text never escapes — that's by design.
    expect(out.text).toContain('Здравствуйте, <Анна>.')
  })
  it('learner email html-escaped', () => {
    const out = render({
      slots: [
        {
          ...baseSlot,
          learnerDisplayName: null,
          learnerEmail: 'a&b@example.com',
        },
      ],
    })
    expect(out.html).toContain('a&amp;b@example.com')
  })
  it('zoom URL html-escaped', () => {
    const out = render({
      slots: [
        {
          ...baseSlot,
          zoomUrl: 'https://meet.google.com/x?a=1&b=2',
        },
      ],
    })
    expect(out.html).toContain('https://meet.google.com/x?a=1&amp;b=2')
  })
})

describe('renderTeacherDailyDigestEmail — CTA + sign-off', () => {
  it('CTA links to /teacher under siteUrl', () => {
    const out = render({ siteUrl: 'https://levelchannel.ru' })
    expect(out.text).toContain('Управлять занятиями: https://levelchannel.ru/teacher')
  })
  it('sign-off uses em-dash, not hyphen', () => {
    const out = render({})
    expect(out.text).toContain('— Команда LevelChannel')
  })
})

describe('TS ↔ mjs renderer drift pin', () => {
  it('produces byte-identical {subject, text, html} for the same input', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const mjsPath = resolvePath(
      here,
      '../../scripts/lib/teacher-daily-digest-template.mjs',
    )
    const mod = (await import(mjsPath)) as {
      renderTeacherDailyDigestEmail: (
        input: Parameters<typeof renderTeacherDailyDigestEmail>[0],
      ) => { subject: string; text: string; html: string }
    }
    const input = {
      teacherDisplayName: 'Анна',
      teacherTimezone: 'Europe/Moscow',
      slots: [
        {
          startAtIso: '2026-06-01T06:00:00.000Z',
          learnerDisplayName: 'Иван П.',
          learnerEmail: 'ivan@example.com',
          zoomUrl: 'https://meet.google.com/abc-defg-hij',
        },
        {
          startAtIso: '2026-06-01T08:00:00.000Z',
          learnerDisplayName: null,
          learnerEmail: 'student@example.com',
          zoomUrl: null,
        },
      ],
      siteUrl: 'https://levelchannel.ru',
    }
    const tsOut = renderTeacherDailyDigestEmail(input)
    const mjsOut = mod.renderTeacherDailyDigestEmail(input)
    expect(JSON.stringify(mjsOut)).toBe(JSON.stringify(tsOut))
  })
})
