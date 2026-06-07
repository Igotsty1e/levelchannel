'use client'

import { useEffect, useState } from 'react'

import { Button, Pill } from '@/components/ui/primitives'
import { TZ_DEFAULT } from '@/lib/util/tz'

function formatRub(rub: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rub)
}

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
      return 'проведено'
    case 'no_show_learner':
      return 'вы не пришли'
    case 'no_show_teacher':
      return 'учитель не пришёл'
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
            <Button variant="ghost" size="sm" href="/cabinet/packages">
              Купить пакет →
            </Button>
          ) : null}
        </div>
        {error ? (
          <p style={{ color: 'var(--danger)', fontSize: 13 }}>
            Не удалось загрузить пакеты. Обновите страницу.
          </p>
        ) : packages === null ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>Загружаем…</p>
        ) : packages.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 14, lineHeight: 1.6 }}>
            Активных пакетов нет. Можно оплачивать каждое занятие
            отдельно — или купить пакет, чтобы записываться без оплаты
            каждый раз.
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
                    <Pill tone={expired ? 'danger' : 'success'} size="sm">
                      {expired
                        ? 'истёк'
                        : `${p.countRemaining} из ${p.countInitial}`}
                    </Pill>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: 'var(--surface-2)',
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
                          ? 'var(--danger)'
                          : 'var(--accent)',
                        transition: 'width 240ms ease-out',
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

      {/* 2026-06-07: «К оплате» полностью скрыто, пока платёжная модель
          per-tariff перерабатывается. Когда оплата вернётся — поставить
          `LESSON_PAYMENT_UI_ENABLED = true` (см. lessons-section.tsx
          для парного флага). Раньше до этого тут уже стояло «debt > 0»
          — это шум, но именно карточка как UI-инициатива пока убрана. */}
      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
      {(false as boolean) && debt !== null && debt.length > 0 ? (
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
            К оплате
          </h2>
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
                      Оплата по договорённости
                    </span>
                  ) : rub !== null && s.tariffSlug ? (
                    <Button
                      variant="primary"
                      size="sm"
                      href={`/checkout/${encodeURIComponent(
                        s.tariffSlug,
                      )}?slot=${encodeURIComponent(s.slotId)}`}
                    >
                      Оплатить {formatRub(rub)}
                    </Button>
                  ) : (
                    <span style={{ color: 'var(--secondary)', fontSize: 12 }}>
                      Цены нет — с вами свяжется оператор
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </>
  )
}
