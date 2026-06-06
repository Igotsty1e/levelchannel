// BCS-DEF-4-PUSH (2026-06-06) — privacy + shape contract for the push
// payload renderer. Round-1 WARN 10 closure: NO zoom URL, NO lesson
// title in the body.

import { describe, expect, it } from 'vitest'

// @ts-expect-error - .mjs untyped
import { renderLearnerPushPayload } from '@/scripts/lib/learner-push-template.mjs'

describe('renderLearnerPushPayload', () => {
  it('renders the title/body/url shape', () => {
    const payload = renderLearnerPushPayload({
      windowMinutes: 60,
      cabinetUrl: 'https://levelchannel.ru/cabinet',
    })
    expect(payload).toEqual({
      title: 'Скоро урок',
      body: 'Через 60 мин начинается ваше занятие. Откройте кабинет, чтобы подключиться.',
      url: 'https://levelchannel.ru/cabinet',
    })
  })

  it('does NOT leak a zoom_url field', () => {
    const payload = renderLearnerPushPayload({
      windowMinutes: 15,
      cabinetUrl: 'https://levelchannel.ru/cabinet',
    })
    expect('zoom_url' in payload).toBe(false)
    expect('zoomUrl' in payload).toBe(false)
  })

  it('does NOT include lesson title or teacher name', () => {
    const payload = renderLearnerPushPayload({
      windowMinutes: 15,
      cabinetUrl: 'https://levelchannel.ru/cabinet',
    })
    const text = `${payload.title}\n${payload.body}\n${payload.url}`
    expect(text).not.toMatch(/teacher|teacherDisplayName|lesson title/i)
  })
})
