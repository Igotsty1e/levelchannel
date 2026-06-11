// teacher-direct-assign (Задача 2.2, Sub-PR B, 2026-06-11) — email tests.

import { describe, expect, it } from 'vitest'

import { renderLearnerDirectAssignNoticeEmail } from '@/lib/email/templates/learner-direct-assign-notice'

const NBSP = '\u00A0'
const FIXTURE_CABINET = 'https://example.test/cabinet'
const FIXTURE_START = new Date('2026-06-15T14:00:00Z') // 17:00 MSK

describe('renderLearnerDirectAssignNoticeEmail', () => {
  it('subject includes formatted date+time', () => {
    const { subject } = renderLearnerDirectAssignNoticeEmail({
      teacherDisplayName: 'Анна',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(subject.startsWith('Назначено занятие — ')).toBe(true)
    // 15 июня, 17:00 МСК — Russian locale formatting
    expect(subject).toMatch(/15.*июня.*17:00/)
  })

  it('greets learner by display name when available', () => {
    const { text } = renderLearnerDirectAssignNoticeEmail({
      teacherDisplayName: 'Анна',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: 'Олег',
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain('Здравствуйте, Олег.')
    expect(text).toContain('Анна назначил(а) вам занятие.')
  })

  it('falls back to anonymous greeting when display name is null', () => {
    const { text } = renderLearnerDirectAssignNoticeEmail({
      teacherDisplayName: null,
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain('Здравствуйте.')
    expect(text).toContain('учитель назначил вам занятие.')
    // No "(а)" suffix when teacher == default literal:
    expect(text.includes('учитель назначил(а)')).toBe(false)
  })

  it('includes duration with NBSP between digit and unit', () => {
    const { text } = renderLearnerDirectAssignNoticeEmail({
      teacherDisplayName: 'Анна',
      startAt: FIXTURE_START,
      durationMinutes: 90,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain(`Длительность: 90${NBSP}минут`)
    expect(text.includes('Длительность: 90 минут')).toBe(false)
  })

  it('includes cabinet URL for reschedule/cancel action', () => {
    const { text, html } = renderLearnerDirectAssignNoticeEmail({
      teacherDisplayName: 'Анна',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(text).toContain(FIXTURE_CABINET)
    expect(html).toContain(`href="${FIXTURE_CABINET}"`)
  })

  it('escapes HTML in teacher display name to prevent injection', () => {
    const { html } = renderLearnerDirectAssignNoticeEmail({
      teacherDisplayName: '<script>alert(1)</script>',
      startAt: FIXTURE_START,
      durationMinutes: 60,
      learnerTimezone: 'Europe/Moscow',
      learnerDisplayName: null,
      cabinetUrl: FIXTURE_CABINET,
    })
    expect(html.includes('<script>alert(1)</script>')).toBe(false)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
