'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { MissingPaymentMethodBanner } from '@/components/cabinet/missing-payment-method-banner'
import { TZ_DEFAULT, safeTz } from '@/lib/util/tz'

// SAAS-PIVOT Epic 7 Day 7 — per-teacher block list on /cabinet for
// multi-teacher learners. One card per active link, with:
//   - teacher name + soft-divider
//   - next-7-day upcoming booked slots (capped 5)
//   - balance owed (kopecks) — from teacher-blocks.ts
//   - active package count
//   - "Записаться к этому учителю" → /cabinet/book?teacher=<id>
//   - inline soft-unlink button with click-twice confirm
//
// Click-twice confirm (no native confirm()): mobile-friendlier than the
// browser dialog AND avoids the design inconsistency a Russian-locale
// `window.confirm` text creates next to our custom UI. First click
// arms; second click within 5 seconds fires the POST. Click anywhere
// else / 5 second TTL → disarmed.

type TeacherBlock = {
  teacherId: string
  teacherDisplayName: string
  upcomingSlots: Array<{
    slotId: string
    startAt: string
    durationMinutes: number
    tariffTitleRu: string | null
  }>
  balanceOwedKopecks: number
  debtSlotCount: number
  activePackageCount: number
  // Bug #1 (2026-06-02). Per-pair payment method from
  // learner_billing_preferences. When 'none', the «Записаться к этому
  // учителю» CTA is replaced with the missing-payment-method banner.
  // epic-b Sub-PR B.1/B.2 (2026-06-11): dropped 'prepaid_packages'.
  paymentMethod: 'postpaid' | 'none'
}

type Props = {
  blocks: TeacherBlock[]
  learnerTimezone: string | null
  // Bug #1: server-side SoT used to decide whether the banner shows
  // its second paragraph («не нужно ничего покупать заранее…»). Same
  // value used to gate «Купить пакет» CTA in `billing-sections.tsx`.
  canBuyPackages: boolean
}

function fmtSlot(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtRub(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString('ru-RU')}\u00a0₽`
}

export function TeacherBlocksList({
  blocks,
  learnerTimezone,
  canBuyPackages,
}: Props) {
  const router = useRouter()
  const tz = safeTz(learnerTimezone)
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function unlink(teacherId: string) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(
        `/api/cabinet/links/${encodeURIComponent(teacherId)}/unlink`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data?.message || data?.error || `HTTP ${res.status}`)
        return
      }
      setArmed(null)
      // Re-render the SSR page so the unlinked teacher's block disappears
      // and the unified timeline refreshes from the n:m set.
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function onArm(teacherId: string) {
    setErr(null)
    setArmed(teacherId)
    // Auto-disarm after 5s if the user walks away.
    setTimeout(() => {
      setArmed((current) => (current === teacherId ? null : current))
    }, 5000)
  }

  if (blocks.length === 0) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        Мои учителя
      </h2>
      {err ? (
        <p
          role="alert"
          style={{
            background: 'rgba(255,140,140,0.15)',
            color: '#ffcfcf',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {err}
        </p>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {blocks.map((b) => (
          <div
            key={b.teacherId}
            className="card"
            style={{ padding: 20 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 8,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
                {b.teacherDisplayName}
              </h3>
              {armed === b.teacherId ? (
                <button
                  type="button"
                  onClick={() => unlink(b.teacherId)}
                  disabled={busy}
                  aria-label={`Подтвердите отвязку от учителя ${b.teacherDisplayName}`}
                  style={{
                    padding: '6px 12px',
                    background: 'rgba(255,140,140,0.2)',
                    color: '#ffcfcf',
                    border: '1px solid #ff8a8a',
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  Подтвердить отвязку
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onArm(b.teacherId)}
                  aria-label={`Отвязаться от учителя ${b.teacherDisplayName}`}
                  style={{
                    padding: '6px 12px',
                    background: 'transparent',
                    color: 'var(--secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Отвязаться
                </button>
              )}
            </div>
            <div
              style={{
                height: 1,
                background: 'var(--border)',
                margin: '0 0 12px 0',
              }}
              aria-hidden="true"
            />

            <p
              style={{
                color: 'var(--secondary)',
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                margin: '0 0 6px 0',
              }}
            >
              Ближайшие занятия (7 дней)
            </p>
            {b.upcomingSlots.length === 0 ? (
              <p
                style={{
                  color: 'var(--secondary)',
                  fontSize: 13,
                  margin: '0 0 12px 0',
                }}
              >
                Нет запланированных занятий.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 12px 0',
                  fontSize: 13,
                  color: 'var(--text)',
                }}
              >
                {b.upcomingSlots.map((s) => (
                  <li key={s.slotId} style={{ padding: '2px 0' }}>
                    {fmtSlot(s.startAt, tz)} ·{' '}
                    <span style={{ color: 'var(--secondary)' }}>
                      {s.durationMinutes} мин
                      {s.tariffTitleRu ? ` · ${s.tariffTitleRu}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 16,
                fontSize: 13,
                color: 'var(--secondary)',
                marginBottom: 12,
              }}
            >
              <span>
                К&nbsp;оплате:{' '}
                <span style={{ color: 'var(--text)' }}>
                  {b.debtSlotCount === 0
                    ? '0\u00a0₽'
                    : fmtRub(b.balanceOwedKopecks)}
                </span>
                {b.debtSlotCount > 0 ? (
                  <>
                    {' '}
                    <span style={{ fontSize: 12 }}>
                      ({b.debtSlotCount}{' '}
                      {b.debtSlotCount === 1 ? 'занятие' : 'занятий'})
                    </span>
                  </>
                ) : null}
              </span>
              <span>
                Активные пакеты:{' '}
                <span style={{ color: 'var(--text)' }}>
                  {b.activePackageCount}
                </span>
              </span>
            </div>

            {b.paymentMethod === 'none' ? (
              <MissingPaymentMethodBanner
                variant="per-teacher"
                canBuyPackages={canBuyPackages}
              />
            ) : (
              <Link
                href={`/cabinet/book?teacher=${encodeURIComponent(b.teacherId)}`}
                style={{
                  display: 'inline-block',
                  padding: '8px 16px',
                  background: 'var(--accent)',
                  color: 'var(--accent-contrast)',
                  borderRadius: 999,
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Записаться к этому учителю
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
