// 2026-06-22 Epic 2 PR-1a B-1 unit test (wave-paranoia round-1 WARN #1 fix).
//
// Регрессия: до фикса `listUnpaidSlotsForPair` подмешивал raw DB
// статус (`booked`/`completed`/`no_show_learner`/`cancelled`) прямо
// в label, и эти английские slugs показывались учителю в UI
// (нарушение content-style §4 «никогда не показывать имя статуса БД
// пользователю»). После фикса:
//   - label не содержит slug ни в каком виде.
//   - В return type добавлено поле `statusLabel` с русским значением
//     для рендера через <Pill>.
//
// Wave-paranoia WARN #1 (round 1): первая версия теста re-declaring
// expected map и rebuilds label locally — могла остаться зелёной даже
// если production regressed. Fix: импортируем `UNPAID_SLOT_STATUS_LABEL_RU`
// и `buildUnpaidSlotLabel` напрямую из production (lib/payments/sbp-claims.ts).

import { describe, expect, it } from 'vitest'

import {
  UNPAID_SLOT_STATUS_LABEL_RU,
  buildUnpaidSlotLabel,
} from '@/lib/payments/sbp-claims'

const FORBIDDEN_DB_SLUGS = ['booked', 'completed', 'no_show_learner', 'cancelled'] as const

describe('buildUnpaidSlotLabel (production helper)', () => {
  it('label не содержит DB-slug ни в одном из 4 статусов', () => {
    const label = buildUnpaidSlotLabel('2026-06-25T14:00:00Z', 60)
    for (const slug of FORBIDDEN_DB_SLUGS) {
      expect(label).not.toContain(slug)
    }
  })

  it('label содержит длительность в нужном формате (substring «· 60 мин»)', () => {
    const label = buildUnpaidSlotLabel('2026-06-25T14:00:00Z', 60)
    expect(label).toContain('· 60 мин')
  })

  it('label содержит дату в русском формате', () => {
    const label = buildUnpaidSlotLabel('2026-06-25T14:00:00Z', 60)
    // ru-RU short month for июнь is «июн.»
    expect(label).toMatch(/июн|25/)
  })
})

describe('UNPAID_SLOT_STATUS_LABEL_RU map (production const)', () => {
  it('покрывает все 4 DB-статуса', () => {
    for (const slug of FORBIDDEN_DB_SLUGS) {
      expect(UNPAID_SLOT_STATUS_LABEL_RU[slug]).toBeDefined()
    }
  })

  it('русский label не равен и не содержит английский slug', () => {
    for (const slug of FORBIDDEN_DB_SLUGS) {
      const ru = UNPAID_SLOT_STATUS_LABEL_RU[slug]
      expect(ru).not.toBe(slug)
      expect(ru).not.toContain(slug)
    }
  })

  it('expected mappings соответствуют content-style', () => {
    expect(UNPAID_SLOT_STATUS_LABEL_RU.booked).toBe('запланировано')
    expect(UNPAID_SLOT_STATUS_LABEL_RU.completed).toBe('прошло')
    expect(UNPAID_SLOT_STATUS_LABEL_RU.no_show_learner).toBe('не пришёл')
    expect(UNPAID_SLOT_STATUS_LABEL_RU.cancelled).toBe('отменено')
  })
})
