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

import { track } from '@/lib/analytics/track'
import type { CloudPaymentsWidgetIntent } from '@/lib/payments/types'

// free-tier-saas-card-and-subscription-row plan §1 item 2 + §0a-3 closure:
// pick-tier grid now accepts 'free' alongside paid tiers. Free renders
// with «Доступен по умолчанию» chip instead of «Подписаться» button.
type Tariff = {
  tier: 'free' | 'mid' | 'pro'
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
  /** A.2 (2026-06-18): pre-select toggle от landing-ссылки ?cycle=annual. */
  initialBillingCycle?: 'monthly' | 'annual'
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

// A.2 annual tariff (2026-06-18): toggle Месяц / Год — global для всех
// карточек платных тарифов. Annual price хардкодится в UI как 4 000 ₽
// (server-side источник в lib/billing/teacher-subscription.ts);
// маркетинговый baseline 4 788 ₽ = 12×399 — также для перечёркивания.
const ANNUAL_PRICE_RUB = 4000
const ANNUAL_BASELINE_RUB = 4788
type BillingCycle = 'monthly' | 'annual'

export function TeacherSubscriptionClient({
  active,
  tariffs,
  initialBillingCycle = 'monthly',
}: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scriptReady, setScriptReady] = useState(false)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    initialBillingCycle,
  )

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
      const tierKey = tier === 'mid' ? 'basic' : 'pro'
      track('subscription_plan_clicked', { tier: tierKey })
      const loadingKey = `${tier}:${billingCycle}`
      setLoading(loadingKey)
      try {
        track('payment_widget_opened', { surface: 'teacher_subscription', tier: tierKey })
        const res = await fetch('/api/teacher/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tier, billingCycle }),
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
    [openWidget, billingCycle],
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

  const isAnnual = billingCycle === 'annual'

  return (
    <section data-testid="teacher-subscription-tiers" style={pickContainerStyle}>
      <p style={leadStyle}>
        «Стартовый» — бесплатно, навсегда, до 3 активных учеников.
        «Оптимальный» — без ограничения по числу учеников, когда практика
        растёт. Платишь месяц или сразу год — на годовой выгоднее на 15%.
        Отменить можно в любой момент — доступ сохранится до конца
        оплаченного периода.
      </p>

      {/* A.2 toggle Месяц / Год — единое управление billingCycle */}
      <div
        role="radiogroup"
        aria-label="Период оплаты"
        data-testid="teacher-subscription-cycle-toggle"
        style={cycleToggleStyle}
      >
        <button
          type="button"
          role="radio"
          aria-checked={!isAnnual}
          onClick={() => setBillingCycle('monthly')}
          data-testid="teacher-subscription-cycle-monthly"
          style={isAnnual ? cycleButtonStyle : cycleButtonActiveStyle}
        >
          Месяц
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isAnnual}
          onClick={() => setBillingCycle('annual')}
          data-testid="teacher-subscription-cycle-annual"
          style={isAnnual ? cycleButtonActiveStyle : cycleButtonStyle}
        >
          Год
          <span style={cycleSaveBadgeStyle}>−15%</span>
        </button>
      </div>

      {error ? <p style={errorStyle}>{error}</p> : null}
      <div style={gridStyle}>
        {tariffs.map((t) => {
          // A.1 tariff reprice (2026-06-18): highlight теперь на единственном
          // публичном платном тарифе (Оптимальный = mid). Pro depublish.
          const isHighlighted = t.tier === 'mid'
          const isFree = t.tier === 'free'
          // A.2 (2026-06-18): annual price 4 000 ₽ / 365 дней доступна
          // только для mid. Free карточка annual игнорирует.
          const showAnnualForCard = isAnnual && t.tier === 'mid'
          return (
            <article
              key={t.tier}
              data-testid={`teacher-subscription-tier-${t.tier}`}
              data-highlight={isHighlighted ? 'true' : 'false'}
              style={{
                ...cardStyle,
                borderColor: isHighlighted ? 'var(--accent)' : 'var(--border)',
                boxShadow: isHighlighted ? '0 0 0 1px var(--accent)' : 'none',
              }}
            >
              {isHighlighted ? (
                <div
                  data-testid={`teacher-subscription-tier-${t.tier}-badge`}
                  style={popularBadgeStyle}
                >
                  Популярный
                </div>
              ) : null}
              <h3 style={cardTitleStyle}>
                {showAnnualForCard ? 'Оптимальный на год' : t.titleRu}
              </h3>
              <div style={cardPriceRowStyle}>
                {isFree ? (
                  <span style={cardPriceStyle}>Бесплатно</span>
                ) : showAnnualForCard ? (
                  <>
                    <span style={cardPriceStyle}>{ANNUAL_PRICE_RUB} ₽</span>
                    <span style={cardPeriodStyle}>/ год</span>
                  </>
                ) : (
                  <>
                    <span style={cardPriceStyle}>{formatPrice(t.amountKopecks)}</span>
                    <span style={cardPeriodStyle}>/ 30 дней</span>
                  </>
                )}
              </div>
              {showAnnualForCard ? (
                <div
                  data-testid={`teacher-subscription-tier-${t.tier}-annual-save`}
                  style={annualSaveBadgeStyle}
                >
                  <span style={annualSaveStrikeStyle}>
                    {ANNUAL_BASELINE_RUB} ₽
                  </span>
                  <span style={annualSaveLabelStyle}>экономия 15%</span>
                </div>
              ) : null}
              <div style={cardLimitStyle}>
                {t.learnerLimit === 0
                  ? 'Без ограничения по числу учеников'
                  : `До ${t.learnerLimit} активных учеников`}
              </div>

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

              {isFree ? (
                // Стартовый — implicit default plan; no «Подписаться»
                // button (free-tier-saas-card-and-subscription-row §0a-3).
                <div
                  data-testid={`teacher-subscription-tier-${t.tier}-chip`}
                  style={{
                    ...subscribeButtonStyle,
                    background: 'transparent',
                    color: 'var(--secondary)',
                    border: '1px dashed var(--border)',
                    cursor: 'default',
                    textAlign: 'center',
                  }}
                >
                  Доступен по умолчанию
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSubscribe(t.tier as 'mid' | 'pro')}
                  disabled={loading !== null || !scriptReady}
                  data-testid={`teacher-subscription-subscribe-${t.tier}`}
                  style={{
                    ...subscribeButtonStyle,
                    background: isHighlighted ? 'var(--accent)' : 'transparent',
                    color: isHighlighted ? '#fff' : 'var(--text)',
                    border: isHighlighted ? 'none' : '1px solid var(--border)',
                  }}
                >
                  {loading?.startsWith(t.tier)
                    ? 'Готовим оплату…'
                    : showAnnualForCard
                    ? 'Оплатить год'
                    : 'Подписаться'}
                </button>
              )}
            </article>
          )
        })}
      </div>
      <p
        style={{
          marginTop: 24,
          fontSize: 12,
          lineHeight: 1.55,
          color: 'var(--secondary)',
          textAlign: 'center',
        }}
      >
        Нажимая «Подписаться», вы акцептуете{' '}
        <a href="/saas/offer" style={{ color: 'var(--accent)' }} target="_blank" rel="noopener noreferrer">SaaS-оферту</a>,{' '}
        <a href="/saas/processor-terms" style={{ color: 'var(--accent)' }} target="_blank" rel="noopener noreferrer">Приложение № 1 (Условия поручения оператору ПДн)</a>,{' '}
        <a href="/privacy" style={{ color: 'var(--accent)' }} target="_blank" rel="noopener noreferrer">политику</a> и{' '}
        <a href="/consent/personal-data" style={{ color: 'var(--accent)' }} target="_blank" rel="noopener noreferrer">согласие на обработку персональных данных</a>.
        Подписка месячная, продлевается автоматически. Отмена — в любой момент через кабинет.
      </p>
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
  marginBottom: 16,
  marginTop: 0,
}

// A.2 annual toggle Месяц / Год — компактный pill-row над cards grid.
const cycleToggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 0,
  background: 'var(--surface, #141416)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 4,
  marginBottom: 20,
}

const cycleButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: 'var(--secondary)',
  padding: '8px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const cycleButtonActiveStyle: React.CSSProperties = {
  ...cycleButtonStyle,
  background: 'var(--accent)',
  color: '#1a1a1a',
}

const cycleSaveBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  background: 'rgba(74, 222, 128, 0.18)',
  color: '#86efac',
  padding: '2px 6px',
  borderRadius: 4,
}

// Save badge внутри annual карточки — зелёная плашка с перечёркнутой
// baseline (12×399=4 788) и labelом «экономия 15%».
const annualSaveBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 9px',
  background: 'rgba(74, 222, 128, 0.14)',
  color: '#86efac',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  marginTop: 6,
  marginBottom: 4,
  alignSelf: 'flex-start',
}

const annualSaveStrikeStyle: React.CSSProperties = {
  color: 'var(--secondary)',
  textDecoration: 'line-through',
  fontWeight: 500,
}

const annualSaveLabelStyle: React.CSSProperties = {
  color: '#86efac',
  fontWeight: 600,
}

const errorStyle: React.CSSProperties = {
  // 2026-06-17 audit: было `#E89A90` (опечатка/раунд-апа акцента).
  // Errors на этой странице должны использовать --danger токен.
  color: 'var(--danger)',
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
