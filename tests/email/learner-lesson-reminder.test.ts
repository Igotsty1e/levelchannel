// BCS-DEF-4 (2026-05-19) — learner lesson reminder template tests.
// Plan: docs/plans/bcs-def-4-learner-reminders.md §3.7 + §3.8.

import { describe, expect, it } from 'vitest'

import { renderLearnerLessonReminderEmail } from '@/lib/email/templates/learner-lesson-reminder'

// NBSP per docs/content-style.md §9 — between digit and unit.
const NBSP = '\u00A0'

// Fixture cabinet URL — tests override paymentConfig.siteUrl by
// passing cabinetUrl explicitly, matching the dispatch wrapper's
// shape. Pinning the literal lets assertions be exact.
const FIXTURE_CABINET = 'https://example.test/cabinet'

// A canonical future date for time-format assertions. UTC instant
// chosen so that Europe/Moscow renders as 17:00.
const FIXTURE_START = new Date('2026-06-01T14:00:00Z')

describe('renderLearnerLessonReminderEmail — subject', () => {
  it('renders default 60-minute window with NBSP between digit and unit', () => {
    const { subject } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(subject).toBe(`Через 60${NBSP}минут — занятие на LevelChannel`)
    // Reject regular ASCII space between digit and unit.
    expect(subject.includes('Через 60 минут')).toBe(false)
  })

  it('substitutes the operator-configured window into the subject', () => {
    const { subject } = renderLearnerLessonReminderEmail({
      windowMinutes: 15,
      teacherDisplayName: 'Иван',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(subject).toBe(`Через 15${NBSP}минут — занятие на LevelChannel`)
  })
})

describe('renderLearnerLessonReminderEmail — body, with Zoom', () => {
  it('renders both Войти: line and the cabinet перенести: line', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: 'https://meet.google.com/abc-defg-hij',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain('Войти: https://meet.google.com/abc-defg-hij')
    expect(text).toContain(`Если нужно перенести: ${FIXTURE_CABINET}`)
  })

  it('treats empty-string zoomUrl identically to null (no Войти: line)', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: '   ',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).not.toContain('Войти:')
  })
})

describe('renderLearnerLessonReminderEmail — body, without Zoom', () => {
  it('drops the Войти: line entirely (no placeholder)', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).not.toContain('Войти:')
    expect(text).not.toContain('ссылка отсутствует')
    expect(text).not.toContain('нет ссылки')
    // Pin: no literal em-dash as a placeholder where Войти: would be.
    // (The sign-off `— Команда LevelChannel` is allowed; ensure the
    // 4-line "когда/длительность" block doesn't have a stranded '—'.)
    expect(text).toContain(`Если нужно перенести: ${FIXTURE_CABINET}`)
  })
})

describe('renderLearnerLessonReminderEmail — teacher fallback', () => {
  it('substitutes «вашим учителем» when display_name is null', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: null,
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain('занятие с учителем вашим учителем')
    // PII guard: no email-shape token in body.
    expect(text).not.toMatch(/@/)
  })

  it('substitutes «вашим учителем» when display_name is whitespace', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: '   ',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain('занятие с учителем вашим учителем')
  })
})

describe('renderLearnerLessonReminderEmail — HTML escaping', () => {
  it('escapes display_name and zoomUrl in the HTML body', () => {
    const { html } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: '<script>alert(1)</script>',
      zoomUrl: 'https://meet.example.com/x?y=1&z=2',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // Ampersand in URL must be escaped.
    expect(html).toContain('y=1&amp;z=2')
  })

  it('plaintext body does NOT escape — raw URL, raw display_name', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна-Мария',
      zoomUrl: 'https://meet.example.com/x?y=1&z=2',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain('Анна-Мария')
    expect(text).toContain('y=1&z=2')
    expect(text).not.toContain('y=1&amp;z=2')
  })
})

describe('renderLearnerLessonReminderEmail — content-style discipline', () => {
  it('sign-off line uses em-dash + Команда LevelChannel', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    // Em-dash (U+2014), not ASCII hyphen.
    expect(text.endsWith('— Команда LevelChannel')).toBe(true)
  })

  it('time-of-day uses 24-hour format (HH:MM, never 12-hour am/pm)', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toMatch(/\d{2}:\d{2}/)
    expect(text).not.toMatch(/\d{1,2}:\d{2}\s?[ap]m/i)
  })

  it('NBSP pinning: «через 60 минут» / «60 минут» use U+00A0', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toMatch(/Через \d+\u00A0минут/)
    // Pin: NO regular-space variant anywhere in the body.
    expect(text).not.toMatch(/Через \d+ минут/)
    expect(text).toMatch(/Длительность: \d+\u00A0минут/)
  })

  it('glossary lint: body uses «занятие» (not «урок» / «слот» / «алерт» / «webhook» / «invoice»)', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: 'https://meet.example.com/x',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain('занятие')
    // Reject any standalone «урок» / «уроки» / «уроков» / «уроку» etc.
    // (Word-boundary regex; allows similar-looking words that don't start
    // with «урок».)
    expect(text).not.toMatch(/\bурок/iu)
    expect(text).not.toMatch(/\bслот/iu)
    expect(text).not.toMatch(/\bалерт/iu)
    expect(text).not.toMatch(/\bwebhook/i)
    expect(text).not.toMatch(/\binvoice/i)
  })

  it('salutation switches on learnerDisplayName presence', () => {
    const named = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: 'Игорь',
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(named.text.startsWith('Здравствуйте, Игорь.')).toBe(true)

    const anonymous = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(anonymous.text.startsWith('Здравствуйте.')).toBe(true)
  })
})

describe('renderLearnerLessonReminderEmail — timezone', () => {
  it('falls back to Europe/Moscow when learnerTimezone is null', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: null,
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain('Europe/Moscow')
    // FIXTURE_START is 14:00Z; MSK is UTC+3, so display = 17:00.
    expect(text).toContain('17:00')
  })

  it('renders Asia/Yekaterinburg time when explicitly passed', () => {
    const { text } = renderLearnerLessonReminderEmail({
      windowMinutes: 60,
      teacherDisplayName: 'Анна',
      zoomUrl: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Asia/Yekaterinburg',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    // UTC+5 — 19:00.
    expect(text).toContain('19:00')
    expect(text).toContain('Asia/Yekaterinburg')
  })
})
