'use client'

// A2 — Mid/Pro teacher-subscription client surface.
//
// Plan: docs/plans/saas-offer-and-landing-redesign.md A2.
// Polish: docs/plans/bug-4-tariff-naming-and-ui.md Sub-PR B (2026-06-02).
//
// Two states:
//   - Has active paid subscription → status card + "Что входит" block +
//     "Отменить" button.
//   - No active paid subscription → two tariff cards (Базовый + Расширенный)
//     with feature-bullets, "Расширенный" carries a "Популярный" badge.
//     Click POSTs /api/teacher/subscribe; on success, opens the CloudPayments
//     widget (or in mock mode, reloads to surface the freshly-activated
//     subscription).

import { useCallback, useEffect, useState } from 'react'

import type { CloudPaymentsWidgetIntent } from '@/lib/payments/types'

type Tariff = {
  tier: 'mid' | 'pro'
  titleRu: string
  amountKopecks: number
  learnerLimit: number
  description: string
  features: string[]
}

type ActiveSubscription = {
  tier: 'mid' | 'pro'
  titleRu: string
  periodEnd: string | null
  amountKopecks: number | null
  cancelledAt: string | null
  features: string[]
}

type Props = {
  active: ActiveSubscription | null
  tariffs: ReadonlyArray<Tariff>
}

type SubscribeResponse = {
  invoiceId: string
  provider: 'cloudpayments' | 'mock'
  status: string
  amountRub: number
  tier: 'mid' | 'pro'
  checkoutIntent: CloudPaymentsWidgetIntent | null
}

// CloudPayments widget global type is declared in
// components/payments/pricing-section.tsx — both files share the
// same Window.cp shape. We rely on the global declaration there;
// duplicating it here would trigger a TS2717 "subsequent declarations"
// conflict. Cast through `unknown` when invoking.

type CloudPaymentsWidgetCtor = new () => {
  oncomplete?: (result: { status?: string; type?: string }) => void
  start: (intent: CloudPaymentsWidgetIntent) => Promise<{ status?: string }>
}

function formatPrice(kopecks: number | null): string {
  if (kopecks == null) return ''
  const rub = Math.round(kopecks / 100)
  return `${rub} ₽`
}

function formatPeriodEnd(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function TeacherSubscriptionClient({ active, tariffs }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scriptReady, setScriptReady] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const cpGlobal = (window as { cp?: { CloudPayments?: unknown } }).cp
    if (cpGlobal?.CloudPayments) {
      setScriptReady(true)
      return
    }
    const tag = document.createElement('script')
    tag.src = 'https://widget.cloudpayments.ru/bundles/cloudpayments.js'
    tag.async = true
    tag.onload = () => setScriptReady(true)
    tag.onerror = () => setError('Не удалось загрузить виджет CloudPayments.')
    document.body.appendChild(tag)
    return () => {
      // Leave the script — it's used by other CP-driven pages too.
    }
  }, [])

  const openWidget = useCallback(async (intent: CloudPaymentsWidgetIntent) => {
    if (typeof window === 'undefined') return
    const cpGlobal = (window as { cp?: { CloudPayments?: unknown } }).cp
    const cls = cpGlobal?.CloudPayments as CloudPaymentsWidgetCtor | undefined
    if (!cls) {
      setError('Виджет CloudPayments не загрузился. Попробуйте ещё раз.')
      return
    }
    const widget = new cls()
    const result = await new Promise<{ status?: string }>((resolve) => {
      widget.oncomplete = (r) =>
        resolve({ status: r?.status || r?.type || 'cancel' })
      widget
        .start(intent)
        .then((r) => {
          if (r?.status === 'success') resolve(r)
        })
        .catch(() => resolve({ status: 'cancel' }))
    })
    if (result.status === 'success') {
      // Webhook already fired and activated the subscription; reload
      // to surface the active state.
      window.location.reload()
    }
  }, [])

  const handleSubscribe = useCallback(
    async (tier: 'mid' | 'pro') => {
      setError(null)
      setLoading(tier)
      try {
        const res = await fetch('/api/teacher/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tier }),
        })
        const data = (await res.json()) as SubscribeResponse | { error: string; message?: string }
        if (!res.ok) {
          const err = data as { error: string; message?: string }
          setError(err.message ?? `Ошибка: ${err.error}`)
          return
        }
        const ok = data as SubscribeResponse
        if (ok.checkoutIntent && ok.provider === 'cloudpayments') {
          await openWidget(ok.checkoutIntent)
        } else if (ok.provider === 'mock') {
          // Mock mode auto-confirmed; reload to show the new active sub.
          window.location.reload()
        } else {
          // CloudPayments configured but widget intent missing (config gap).
          setError('Не удалось подготовить оплату. Попробуйте позже.')
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Не удалось обработать запрос.',
        )
      } finally {
        setLoading(null)
      }
    },
    [openWidget],
  )

  const handleCancel = useCallback(async () => {
    if (!window.confirm('Отменить подписку? Доступ сохранится до конца оплаченного периода.')) {
      return
    }
    setError(null)
    setLoading('cancel')
    try {
      const res = await fetch('/api/teacher/subscription/cancel', {
        method: 'POST',
      })
      const data = (await res.json()) as { error?: string; message?: string }
      if (!res.ok) {
        setError(data.message ?? `Ошибка: ${data.error}`)
        return
      }
      window.location.reload()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось отменить подписку.',
      )
    } finally {
      setLoading(null)
    }
  }, [])

  if (active) {
    return (
      <section data-testid="teacher-subscription-active" style={activeContainerStyle}>
        <div style={activeHeaderRowStyle}>
          <div>
            <div
              data-testid="teacher-subscription-active-badge"
              style={currentBadgeStyle}
            >
              <span aria-hidden="true">● </span>Текущий тариф
            </div>
            <h2 style={activeTitleStyle}>{active.titleRu}</h2>
            <div style={activePriceStyle}>
              {formatPrice(active.amountKopecks)}
              <span style={pricePeriodStyle}> / 30 дней</span>
            </div>
          </div>
        </div>

        <div style={activeBodyStyle}>
          <div>
            <h3 style={subSectionTitleStyle}>Что входит в тариф</h3>
            <ul
              data-testid="teacher-subscription-active-features"
              style={featureListStyle}
            >
              {active.features.map((line) => (
                <li key={line} style={featureLineStyle}>
                  <span aria-hidden="true" style={featureBulletStyle}>●</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 style={subSectionTitleStyle}>Период и оплата</h3>
            <dl style={dlStyle}>
              <dt style={dtStyle}>Период оплачен до</dt>
              <dd style={ddStyle}>{formatPeriodEnd(active.periodEnd)}</dd>
              {active.cancelledAt ? (
                <>
                  <dt style={dtStyle}>Подписка отменена</dt>
                  <dd style={ddStyle}>
                    {formatPeriodEnd(active.cancelledAt)}
                    <span style={hintStyle}>
                      {' '}
                      — доступ до конца оплаченного периода
                    </span>
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        </div>

        {error ? <p style={errorStyle}>{error}</p> : null}

        {!active.cancelledAt ? (
          <div style={activeFooterStyle}>
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading !== null}
              data-testid="teacher-subscription-cancel-button"
              style={cancelButtonStyle}
            >
              {loading === 'cancel' ? 'Отменяем…' : 'Отменить подписку'}
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <section data-testid="teacher-subscription-tiers" style={pickContainerStyle}>
      <p style={leadStyle}>
        «Стартовый» — бесплатно, навсегда, для одного ученика.
        «Базовый» и «Расширенный» — когда учеников становится больше.
        Платёж разовый, без автосписания: 30 дней доступа за одно
        списание. Отменить можно в любой момент — доступ сохранится
        до конца оплаченного периода.
      </p>
      {error ? <p style={errorStyle}>{error}</p> : null}
      <div style={gridStyle}>
        {tariffs.map((t) => {
          const isPro = t.tier === 'pro'
          return (
            <article
              key={t.tier}
              data-testid={`teacher-subscription-tier-${t.tier}`}
              data-highlight={isPro ? 'true' : 'false'}
              style={{
                ...cardStyle,
                borderColor: isPro ? 'var(--accent)' : 'var(--border)',
                boxShadow: isPro ? '0 0 0 1px var(--accent)' : 'none',
              }}
            >
              {isPro ? (
                <div
                  data-testid={`teacher-subscription-tier-${t.tier}-badge`}
                  style={popularBadgeStyle}
                >
                  Популярный
                </div>
              ) : null}
              <h3 style={cardTitleStyle}>{t.titleRu}</h3>
              <div style={cardPriceRowStyle}>
                <span style={cardPriceStyle}>{formatPrice(t.amountKopecks)}</span>
                <span style={cardPeriodStyle}>/ 30 дней</span>
              </div>
              <div style={cardLimitStyle}>До {t.learnerLimit} активных учеников</div>

              <ul
                data-testid={`teacher-subscription-tier-${t.tier}-features`}
                style={featureListStyle}
              >
                {t.features.map((line) => (
                  <li key={line} style={featureLineStyle}>
                    <span style={featureBulletStyle}>●</span>
                    {line}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => handleSubscribe(t.tier)}
                disabled={loading !== null || !scriptReady}
                data-testid={`teacher-subscription-subscribe-${t.tier}`}
                style={{
                  ...subscribeButtonStyle,
                  background: isPro ? 'var(--accent)' : 'transparent',
                  color: isPro ? '#fff' : 'var(--text)',
                  border: isPro ? 'none' : '1px solid var(--border)',
                }}
              >
                {loading === t.tier ? 'Готовим оплату…' : 'Подписаться'}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

// ─── Active subscription card ───────────────────────────────────

const activeContainerStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 28,
  marginBottom: 24,
}

const activeHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  marginBottom: 24,
  paddingBottom: 20,
  borderBottom: '1px solid var(--border)',
}

const currentBadgeStyle: React.CSSProperties = {
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  marginBottom: 6,
}

const activeTitleStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 700,
  margin: 0,
  marginBottom: 4,
}

const activePriceStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text)',
}

const pricePeriodStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  color: 'var(--secondary)',
}

const activeBodyStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 28,
  marginBottom: 20,
}

const subSectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  margin: 0,
  marginBottom: 10,
  color: 'var(--secondary)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}

const activeFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: 8,
}

// ─── Pick-a-tier surface ────────────────────────────────────────

const pickContainerStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 24,
  marginBottom: 24,
}

const leadStyle: React.CSSProperties = {
  color: 'var(--secondary)',
  fontSize: 13,
  lineHeight: 1.7,
  marginBottom: 24,
  marginTop: 0,
}

const errorStyle: React.CSSProperties = {
  color: '#E89A90',
  fontSize: 13,
  marginBottom: 16,
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 16,
}

const cardStyle: React.CSSProperties = {
  position: 'relative',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '24px 20px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const popularBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: -10,
  right: 16,
  background: 'var(--accent)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  padding: '4px 10px',
  borderRadius: 6,
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  margin: 0,
  marginBottom: 4,
}

const cardPriceRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
}

const cardPriceStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: 'var(--text)',
}

const cardPeriodStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--secondary)',
  fontWeight: 400,
}

const cardLimitStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--secondary)',
  marginBottom: 6,
}

const subscribeButtonStyle: React.CSSProperties = {
  marginTop: 'auto',
  padding: '10px 14px',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}

// ─── Shared bits ────────────────────────────────────────────────

const featureListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const featureLineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 13,
  color: 'var(--text)',
  lineHeight: 1.5,
}

const featureBulletStyle: React.CSSProperties = {
  color: 'var(--accent)',
  fontSize: 9,
  lineHeight: 1.5,
  marginTop: 2,
  flexShrink: 0,
}

const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '8px 16px',
  margin: 0,
  fontSize: 13,
}

const dtStyle: React.CSSProperties = {
  color: 'var(--secondary)',
}

const ddStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--text)',
  fontWeight: 500,
}

const hintStyle: React.CSSProperties = {
  color: 'var(--secondary)',
  fontWeight: 400,
}

const cancelButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
}
