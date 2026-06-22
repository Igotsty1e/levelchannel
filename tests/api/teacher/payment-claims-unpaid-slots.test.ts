// 2026-06-22 Epic 2 PR-1a B-1 route-level serialization contract test.
//
// Endpoint `/api/teacher/payment-claims/unpaid-slots` маршрутизирует
// `listUnpaidSlotsForPair()` helper в JSON. Этот тест ловит регрессию
// если кто-то добавит обратно `${row.status}` в label ИЛИ забудет
// маппить `statusLabel` на русский. Helper тестируется отдельно
// (`tests/payments/sbp-claims-unpaid-label.test.ts`), здесь — гарантия
// что route не муцает shape по дороге к клиенту.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/guards', () => ({
  requireTeacherWithCurrentSaasOfferConsent: vi.fn(async () => ({
    ok: true as const,
    account: { id: 'teacher-1', email: 't@test', role: 'teacher' as const },
  })),
}))

vi.mock('@/lib/security/request', () => ({
  enforceRateLimit: vi.fn(async () => null),
}))

vi.mock('@/lib/payments/sbp-claims', () => ({
  listUnpaidSlotsForPair: vi.fn(async () => [
    {
      id: 's1',
      label: '25 июн., 17:00 · 60 мин',
      statusLabel: 'запланировано',
      expectedKopecks: 160_000,
      startAt: '2026-06-25T14:00:00Z',
      status: 'booked',
    },
    {
      id: 's2',
      label: '19 июн., 16:00 · 60 мин',
      statusLabel: 'прошло',
      expectedKopecks: 160_000,
      startAt: '2026-06-19T13:00:00Z',
      status: 'completed',
    },
  ]),
}))

import { GET } from '@/app/api/teacher/payment-claims/unpaid-slots/route'

describe('GET /api/teacher/payment-claims/unpaid-slots', () => {
  it('returns slots с clean label + русский statusLabel', async () => {
    const req = new Request('https://example.test/api/teacher/payment-claims/unpaid-slots?learner=L1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.slots)).toBe(true)
    expect(body.slots).toHaveLength(2)
    for (const slot of body.slots) {
      // B-1 contract: no DB slug in label.
      for (const slug of ['booked', 'completed', 'no_show_learner', 'cancelled']) {
        expect(slot.label).not.toContain(slug)
      }
      // Russian statusLabel present.
      expect(typeof slot.statusLabel).toBe('string')
      expect(slot.statusLabel.length).toBeGreaterThan(0)
      // Не равен английскому slug.
      expect(slot.statusLabel).not.toBe(slot.status)
    }
  })

  it('returns 400 без learner query', async () => {
    const req = new Request('https://example.test/api/teacher/payment-claims/unpaid-slots')
    const res = await GET(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('learner_required')
  })
})
