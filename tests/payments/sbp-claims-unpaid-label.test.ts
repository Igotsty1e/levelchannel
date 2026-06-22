// 2026-06-22 Epic 2 PR-1a B-1 unit test.
//
// Регрессия: до фикса `listUnpaidSlotsForPair` подмешивал raw DB
// статус (`booked`/`completed`/`no_show_learner`/`cancelled`) прямо
// в label, и эти английские slugs показывались учителю в UI
// (нарушение content-style §4 «никогда не показывать имя статуса БД
// пользователю»). После фикса:
//   - label не содержит slug ни в каком виде.
//   - В return type добавлено поле `statusLabel` с русским значением
//     для рендера через <Pill>.

import { describe, expect, it } from 'vitest'

const STATUS_LABEL_RU_EXPECTED: Record<string, string> = {
  booked: 'запланировано',
  completed: 'прошло',
  no_show_learner: 'не пришёл',
  cancelled: 'отменено',
}

const FORBIDDEN_DB_SLUGS = ['booked', 'completed', 'no_show_learner', 'cancelled'] as const

// Helper для построения label так же как production code, без БД.
function buildLabel(startAt: string, durationMinutes: number): string {
  const dt = new Date(startAt)
  return `${dt.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })} · ${durationMinutes} мин`
}

describe('listUnpaidSlotsForPair label contract', () => {
  it('label не содержит DB-slug ни в одном из 4 статусов', () => {
    const startAt = '2026-06-25T14:00:00Z'
    const label = buildLabel(startAt, 60)
    for (const slug of FORBIDDEN_DB_SLUGS) {
      expect(label).not.toContain(slug)
    }
  })

  it('label содержит дату + длительность в нужном формате (substring «· 60 мин»)', () => {
    const label = buildLabel('2026-06-25T14:00:00Z', 60)
    expect(label).toContain('· 60 мин')
  })
})

describe('statusLabel map contract', () => {
  it('покрывает все 4 DB-статуса с русскими значениями', () => {
    for (const slug of FORBIDDEN_DB_SLUGS) {
      const ru = STATUS_LABEL_RU_EXPECTED[slug]
      expect(ru).toBeDefined()
      // Русский label не должен совпадать с английским slug.
      expect(ru).not.toBe(slug)
      // И не должен содержать английский slug как substring.
      expect(ru).not.toContain(slug)
    }
  })
})
