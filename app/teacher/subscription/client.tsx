'use client'

// A2 — Mid/Pro teacher-subscription client surface.
//
// Plan: docs/plans/saas-offer-and-landing-redesign.md A2.
//
// Two states:
//   - Has active paid subscription → status card + "Отменить" button.
//   - No active paid subscription → two tariff cards (Mid + Pro) with
//     "Подписаться" buttons. Click POSTs /api/teacher/subscribe; on
//     success, opens the CloudPayments widget (or in mock mode,
//     reloads to surface the freshly-activated subscription).

import { useCallback, useEffect, useState } from 'react'

import type { CloudPaymentsWidgetIntent } from '@/lib/payments/types'

type Tariff = {
  tier: 'mid' | 'pro'
  titleRu: string
  amountKopecks: number
  learnerLimit: number
  description: string
}

type ActiveSubscription = {
  tier: 'mid' | 'pro'
  titleRu: string
  periodEnd: string | null
  amountKopecks: number | null
  cancelledAt: string | null
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
      <section data-testid="teacher-subscription-active" style={containerStyle}>
        <h2 style={headingStyle}>Подписка {active.titleRu}</h2>
        <dl style={dlStyle}>
          <dt style={dtStyle}>Тариф</dt>
          <dd style={ddStyle}>{active.titleRu}</dd>
          <dt style={dtStyle}>Цена</dt>
          <dd style={ddStyle}>{formatPrice(active.amountKopecks)}/30 дней</dd>
          <dt style={dtStyle}>Период оплачен до</dt>
          <dd style={ddStyle}>{formatPeriodEnd(active.periodEnd)}</dd>
          {active.cancelledAt ? (
            <>
              <dt style={dtStyle}>Подписка отменена</dt>
              <dd style={ddStyle}>
                {formatPeriodEnd(active.cancelledAt)} — доступ до конца оплаченного периода
              </dd>
            </>
          ) : null}
        </dl>
        {error ? <p style={errorStyle}>{error}</p> : null}
        {!active.cancelledAt ? (
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading !== null}
            data-testid="teacher-subscription-cancel-button"
            style={cancelButtonStyle}
          >
            {loading === 'cancel' ? 'Отменяем…' : 'Отменить подписку'}
          </button>
        ) : null}
      </section>
    )
  }

  return (
    <section data-testid="teacher-subscription-tiers" style={containerStyle}>
      <h2 style={headingStyle}>Выберите тариф</h2>
      <p style={leadStyle}>
        Платный тариф открывает кабинет на 30 дней. Оплата — разовая, без
        автосписаний; чтобы продлить — оплатите ещё раз. Отменить можно в
        любой момент — доступ сохранится до конца оплаченного периода.
      </p>
      {error ? <p style={errorStyle}>{error}</p> : null}
      <div style={gridStyle}>
        {tariffs.map((t) => (
          <article
            key={t.tier}
            data-testid={`teacher-subscription-tier-${t.tier}`}
            style={cardStyle}
          >
            <h3 style={cardTitleStyle}>{t.titleRu}</h3>
            <div style={priceStyle}>{formatPrice(t.amountKopecks)}</div>
            <div style={periodStyle}>за 30 дней</div>
            <div style={limitStyle}>До {t.learnerLimit} учеников</div>
            <button
              type="button"
              onClick={() => handleSubscribe(t.tier)}
              disabled={loading !== null || !scriptReady}
              data-testid={`teacher-subscription-subscribe-${t.tier}`}
              style={subscribeButtonStyle}
            >
              {loading === t.tier ? 'Готовим оплату…' : 'Подписаться'}
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

const containerStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 24,
  marginBottom: 24,
}

const headingStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  marginBottom: 12,
}

const leadStyle: React.CSSProperties = {
  color: 'var(--secondary)',
  fontSize: 13,
  lineHeight: 1.6,
  marginBottom: 20,
}

const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '8px 16px',
  margin: 0,
  marginBottom: 20,
  fontSize: 14,
}

const dtStyle: React.CSSProperties = {
  color: 'var(--secondary)',
}

const ddStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--text)',
  fontWeight: 500,
}

const errorStyle: React.CSSProperties = {
  color: '#E89A90',
  fontSize: 13,
  marginBottom: 16,
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 16,
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '20px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  margin: 0,
}

const priceStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--text)',
}

const periodStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--secondary)',
}

const limitStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--secondary)',
  marginBottom: 4,
}

const subscribeButtonStyle: React.CSSProperties = {
  marginTop: 'auto',
  padding: '10px 14px',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
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
