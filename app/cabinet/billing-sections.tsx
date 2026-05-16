'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// Billing wave PR 3 — cabinet sections for prepaid packages and
// postpaid debt. Two parallel containers, no merged ledger.
//
// Reads: GET /api/account/packages (own active list with derived
// countRemaining), GET /api/account/postpaid-debt (own debt list).
// Both endpoints are own-data-only (401 on anonymous).

type AccountPackage = {
  id: string
  packageId: string
  paymentOrderId: string
  amountKopecks: number
  currency: string
  titleSnapshot: string
  durationMinutes: number
  countInitial: number
  countRemaining: number
  countConsumed: number
  expiresAt: string
  createdAt: string
}

type PostpaidDebt = {
  slotId: string
  startAt: string
  durationMinutes: number
  status: string
  tariffId: string | null
  // Wave 45 — server now passes the slug too so the "Оплатить" link
  // can hit /checkout/[tariffSlug] which resolves by slug, not UUID.
  tariffSlug: string | null
  expectedAmountKopecks: number | null
  legacyGrandfathered: boolean
}

const TZ_DEFAULT = 'Europe/Moscow'

function safeFmtTime(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: tz,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function safeFmtDate(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      timeZone: tz,
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'completed':
      return 'проведён'
    case 'no_show_learner':
      return 'не пришёл'
    case 'no_show_teacher':
      return 'не пришёл учитель'
    default:
      return s
  }
}

export function BillingSections({
  learnerTimezone,
  canBuyPackages,
}: {
  learnerTimezone: string | null
  // Epic-end paranoia round 1 WARN #3 — only show the "Купить пакет"
  // CTA to fully-eligible learners. Cabinet renders this card for
  // unverified + deletion-grace accounts too (they still see their
  // existing packages), but /cabinet/packages would redirect them
  // back via isLearnerArchetypeCandidate. Server passes the SoT
  // verdict here so we never display a CTA that the server will
  // refuse on click.
  canBuyPackages: boolean
}) {
  const tz = learnerTimezone ?? TZ_DEFAULT
  const [packages, setPackages] = useState<AccountPackage[] | null>(null)
  const [debt, setDebt] = useState<PostpaidDebt[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [pkRes, dRes] = await Promise.all([
          fetch('/api/account/packages', { cache: 'no-store' }),
          fetch('/api/account/postpaid-debt', { cache: 'no-store' }),
        ])
        if (cancelled) return
        if (!pkRes.ok) throw new Error(`packages HTTP ${pkRes.status}`)
        if (!dRes.ok) throw new Error(`debt HTTP ${dRes.status}`)
        const pkBody = await pkRes.json()
        const dBody = await dRes.json()
        setPackages(pkBody.packages ?? [])
        setDebt(dBody.debt ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 12,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            Мои пакеты
          </h2>
          {/* PKG-LEARNER-BUY LBL.2 + epic-close WARN #3 — discovery CTA
              to /cabinet/packages, only rendered when the server says
              the account is buy-eligible. */}
          {canBuyPackages ? (
            <Link
              href="/cabinet/packages"
              style={{
                fontSize: 13,
                color: 'var(--accent, #5b8ef7)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Купить пакет →
            </Link>
          ) : null}
        </div>
        {error ? (
          <p style={{ color: '#ff8a8a', fontSize: 13 }}>Ошибка: {error}</p>
        ) : packages === null ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>Загрузка…</p>
        ) : packages.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
            У вас нет активных пакетов. Каждое занятие нужно оплачивать
            отдельно, или приобретите пакет, чтобы записываться без
            повторной оплаты.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {packages.map((p) => {
              const ratio = p.countInitial > 0 ? p.countRemaining / p.countInitial : 0
              const expired = new Date(p.expiresAt).getTime() <= Date.now()
              return (
                <li
                  key={p.id}
                  style={{
                    padding: '12px 0',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 12,
                    }}
                  >
                    <strong style={{ fontSize: 15 }}>
                      {p.titleSnapshot}
                    </strong>
                    <span
                      style={{
                        fontSize: 13,
                        color: expired ? '#ff8a8a' : '#9bdf9b',
                      }}
                    >
                      {expired
                        ? 'истёк'
                        : `осталось ${p.countRemaining} из ${p.countInitial}`}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: 3,
                      marginTop: 8,
                      overflow: 'hidden',
                    }}
                    aria-hidden="true"
                  >
                    <div
                      style={{
                        width: `${Math.round(ratio * 100)}%`,
                        height: '100%',
                        background: expired
                          ? 'rgba(220,80,80,0.5)'
                          : 'rgba(155,223,155,0.55)',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      color: 'var(--secondary)',
                      fontSize: 12,
                      marginTop: 6,
                    }}
                  >
                    Действителен до {safeFmtDate(p.expiresAt, tz)} ·{' '}
                    {p.durationMinutes} мин/занятие
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          К оплате
        </h2>
        {debt === null ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>Загрузка…</p>
        ) : debt.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14 }}>
            Нет неоплаченных проведённых занятий.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {debt.map((s) => {
              const rub =
                s.expectedAmountKopecks !== null
                  ? Math.round(s.expectedAmountKopecks / 100)
                  : null
              return (
                <li
                  key={s.slotId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 0',
                    borderTop: '1px solid var(--border)',
                    fontSize: 14,
                  }}
                >
                  <span>
                    {safeFmtTime(s.startAt, tz)} ·{' '}
                    <span style={{ color: 'var(--secondary)' }}>
                      {s.durationMinutes} мин · {statusLabel(s.status)}
                    </span>
                  </span>
                  {s.legacyGrandfathered ? (
                    <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
                      Унаследованный · оплата по договорённости
                    </span>
                  ) : rub !== null ? (
                    <a
                      href={
                        s.tariffSlug
                          ? `/checkout/${encodeURIComponent(
                              s.tariffSlug,
                            )}?slot=${encodeURIComponent(s.slotId)}`
                          : '#'
                      }
                      style={{
                        padding: '4px 12px',
                        background: 'var(--accent)',
                        color: 'var(--accent-contrast)',
                        borderRadius: 6,
                        fontSize: 12,
                        textDecoration: 'none',
                      }}
                    >
                      Оплатить {rub.toLocaleString('ru-RU')} ₽
                    </a>
                  ) : (
                    <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
                      Без цены — оператор свяжется
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
