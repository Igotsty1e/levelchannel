import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { renderTeacherDailyDigestTelegram } from '@/lib/notifications/teacher-digest-telegram-template'

// BCS-DEF-5-TG (2026-05-21) — Telegram body renderer tests + TS ↔ mjs
// drift pin. Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md
// §3.9.

const tz = 'Europe/Moscow'
const baseSlot = {
  startAtIso: '2026-06-01T06:00:00.000Z', // 09:00 MSK
  learnerDisplayName: 'Иван П.',
  learnerEmail: 'ivan@example.com',
  zoomUrl: 'https://meet.google.com/abc-defg-hij',
}

function render(
  overrides: Partial<Parameters<typeof renderTeacherDailyDigestTelegram>[0]>,
) {
  return renderTeacherDailyDigestTelegram({
    teacherDisplayName: 'Анна',
    teacherTimezone: tz,
    slots: [baseSlot],
    siteUrl: 'https://levelchannel.ru',
    ...overrides,
  })
}

describe('renderTeacherDailyDigestTelegram — header + cta + footer', () => {
  it('emits header with count + plural noun', () => {
    const out = render({ slots: [baseSlot] })
    expect(out).toContain('LevelChannel — занятия на сегодня')
    expect(out).toContain('1 занятие')
  })
  it('emits cta with /teacher path', () => {
    const out = render({})
    expect(out).toContain('Открыть календарь: https://levelchannel.ru/teacher')
  })
  it('emits /stop footer', () => {
    const out = render({})
    expect(out).toContain('Отписаться от Telegram-дайджеста: /stop')
  })
  it('0 slots throws (defensive guard)', () => {
    expect(() => render({ slots: [] })).toThrow(/slots\.length must be >= 1/)
  })
})

describe('renderTeacherDailyDigestTelegram — slot rendering', () => {
  it('emits HH:MM in teacher timezone', () => {
    const out = render({})
    expect(out).toContain('09:00')
  })
  it('emits displayName when present', () => {
    const out = render({})
    expect(out).toContain('Иван П.')
  })
  it('emits email when displayName is null', () => {
    const out = render({
      slots: [
        {
          ...baseSlot,
          learnerDisplayName: null,
          learnerEmail: 'student@example.com',
        },
      ],
    })
    expect(out).toContain('student@example.com')
  })
  it('emits zoom-url inline when present', () => {
    const out = render({})
    expect(out).toContain('zoom: https://meet.google.com/abc-defg-hij')
  })
  it('omits zoom-url when null', () => {
    const out = render({
      slots: [{ ...baseSlot, zoomUrl: null }],
    })
    expect(out).not.toContain('zoom:')
  })
})

describe('renderTeacherDailyDigestTelegram — body cap 1024', () => {
  it('1-slot day fits well under cap', () => {
    const out = render({})
    expect(out.length).toBeLessThanOrEqual(1024)
  })
  it('5-slot day with zoom-urls fits under cap', () => {
    const slots = Array(5)
      .fill(0)
      .map((_, i) => ({
        ...baseSlot,
        startAtIso: `2026-06-01T${String(6 + i).padStart(2, '0')}:00:00.000Z`,
      }))
    const out = render({ slots })
    expect(out.length).toBeLessThanOrEqual(1024)
  })
  it('many-slots day with long names truncates gracefully', () => {
    const longName = 'А'.repeat(60)
    const slots = Array(15)
      .fill(0)
      .map((_, i) => ({
        startAtIso: `2026-06-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
        learnerDisplayName: `${longName}-${i}`,
        learnerEmail: `student${i}@example.com`,
        zoomUrl: `https://meet.google.com/long-url-${i}-aaaa-bbbb-cccc`,
      }))
    const out = render({ slots })
    expect(out.length).toBeLessThanOrEqual(1024)
    // Header + cta + footer still present.
    expect(out).toContain('LevelChannel — занятия на сегодня')
    expect(out).toContain('Открыть календарь:')
    expect(out).toContain('/stop')
  })
})

describe('renderTeacherDailyDigestTelegram — plain text (no markdown chars)', () => {
  it('emits no `*`, `_`, `[`, `]` in output (defends against MarkdownV2 escape failures)', () => {
    const out = render({})
    expect(out).not.toMatch(/[*_\[\]]/)
  })
})

describe('TS ↔ mjs drift pin', () => {
  it('produces byte-identical string for the same input', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const mjsPath = resolvePath(
      here,
      '../../scripts/lib/teacher-daily-digest-telegram-template.mjs',
    )
    const mod = (await import(mjsPath)) as {
      renderTeacherDailyDigestTelegram: (
        input: Parameters<typeof renderTeacherDailyDigestTelegram>[0],
      ) => string
    }
    const input: Parameters<typeof renderTeacherDailyDigestTelegram>[0] = {
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
    const tsOut = renderTeacherDailyDigestTelegram(input)
    const mjsOut = mod.renderTeacherDailyDigestTelegram(input)
    expect(mjsOut).toBe(tsOut)
  })
})
