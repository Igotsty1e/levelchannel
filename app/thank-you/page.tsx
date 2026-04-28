'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'

import { formatRubles } from '@/lib/payments/catalog'
import type { PublicPaymentOrder } from '@/lib/payments/types'

async function fetchOrder(invoiceId: string) {
  const response = await fetch(`/api/payments/${invoiceId}`, {
    cache: 'no-store',
  })

  const payload = (await response.json()) as {
    order?: PublicPaymentOrder
    error?: string
  }

  if (!response.ok || !payload.order) {
    throw new Error(payload.error || 'Не удалось получить статус оплаты.')
  }

  return payload.order
}

export default function ThankYouPage() {
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const [order, setOrder] = useState<PublicPaymentOrder | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    setInvoiceId(params.get('invoiceId'))
  }, [])

  useEffect(() => {
    if (!invoiceId) {
      setError('Не найден номер платежа.')
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const nextOrder = await fetchOrder(invoiceId)

        if (!cancelled) {
          setOrder(nextOrder)
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Не удалось получить статус оплаты.',
          )
        }
      }
    }

    load()

    const interval = window.setInterval(() => {
      if (
        order?.status === 'paid' ||
        order?.status === 'failed' ||
        order?.status === 'cancelled'
      ) {
        window.clearInterval(interval)
        return
      }

      load()
    }, 4000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [invoiceId, order?.status])

  const status = order?.status || 'pending'
  const statusContent = getStatusContent(status)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0B0B0C',
        color: '#fff',
        fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
        padding: '80px 24px',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        style={{
          width: 'min(100%, 720px)',
          background: '#111113',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 28,
          padding: '40px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -80,
            right: -60,
            width: 220,
            height: 220,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(232,168,144,0.18) 0%, transparent 72%)',
          }}
        />

        <StatusBadge status={status} />

        <h1
          style={{
            fontSize: 'clamp(28px, 4vw, 42px)',
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.03em',
            margin: '20px 0 14px',
            maxWidth: 520,
          }}
        >
          {statusContent.title}
        </h1>

        <p style={{ color: '#A1A1AA', fontSize: 16, lineHeight: 1.75, maxWidth: 560 }}>
          {statusContent.description}
        </p>

        {order ? (
          <div
            style={{
              marginTop: 28,
              borderRadius: 20,
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.03)',
              padding: '18px 20px',
              display: 'grid',
              gap: 12,
            }}
          >
            <InfoRow label="Сумма" value={`${formatRubles(order.amountRub)} ₽`} />
            <InfoRow label="Статус" value={statusText(order.status)} />
            {status !== 'paid' ? (
              <InfoRow
                label="Последнее обновление"
                value={new Date(order.updatedAt).toLocaleString('ru-RU')}
              />
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p style={{ marginTop: 20, color: '#FCA5A5', fontSize: 14 }}>{error}</p>
        ) : null}

        <div
          style={{
            marginTop: 30,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Link href={statusContent.primaryHref} style={primaryLinkStyle}>
            {statusContent.primaryLabel}
          </Link>
          {statusContent.showTelegram ? (
            <a
              href="https://t.me/anastasiia_englishcoach"
              target="_blank"
              rel="noopener noreferrer"
              style={secondaryLinkStyle}
            >
              Написать в Telegram
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function getStatusContent(status: PublicPaymentOrder['status'] | 'pending') {
  switch (status) {
    case 'paid':
      return {
        title: 'Оплата принята',
        description:
          'Электронный чек отправит CloudPayments / CloudKassir на e-mail, который вы указали в форме оплаты.',
        primaryHref: '/',
        primaryLabel: 'Вернуться на главную',
        showTelegram: true,
      }
    case 'failed':
      return {
        title: 'Оплата не завершена',
        description:
          'Банк или платёжная форма не подтвердили списание. Можно вернуться на сайт и создать новую оплату.',
        primaryHref: '/#teacher',
        primaryLabel: 'Попробовать ещё раз',
        showTelegram: false,
      }
    case 'cancelled':
      return {
        title: 'Платёжная форма закрыта',
        description:
          'Оплата не была завершена. Если списания не было, можно вернуться на сайт и создать новую оплату.',
        primaryHref: '/#teacher',
        primaryLabel: 'Вернуться к оплате',
        showTelegram: false,
      }
    default:
      return {
        title: 'Ждём подтверждение банка',
        description:
          'Если вы уже подтвердили оплату в банке, статус на этой странице обновится автоматически. От вас больше ничего не требуется.',
        primaryHref: '/#teacher',
        primaryLabel: 'Вернуться к форме оплаты',
        showTelegram: true,
      }
  }
}

function StatusBadge({ status }: { status: PublicPaymentOrder['status'] | 'pending' }) {
  const color =
    status === 'paid'
      ? '#86EFAC'
      : status === 'failed'
        ? '#FCA5A5'
        : '#FDE68A'
  const background =
    status === 'paid'
      ? 'rgba(74, 222, 128, 0.12)'
      : status === 'failed'
        ? 'rgba(248, 113, 113, 0.12)'
        : 'rgba(250, 204, 21, 0.12)'

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 999,
        background,
        color,
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
        }}
      />
      {statusText(status)}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 14,
        alignItems: 'baseline',
      }}
    >
      <span style={{ color: '#71717A', fontSize: 13 }}>{label}</span>
      <span style={{ color: '#E4E4E7', fontSize: 14, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function statusText(status: PublicPaymentOrder['status'] | 'pending') {
  switch (status) {
    case 'paid':
      return 'Оплачен'
    case 'failed':
      return 'Неуспешно'
    case 'cancelled':
      return 'Отменён'
    default:
      return 'Ожидает подтверждения'
  }
}

const primaryLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 48,
  padding: '0 20px',
  borderRadius: 14,
  background: 'linear-gradient(135deg, #C87878 0%, #E8A890 100%)',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
}

const secondaryLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 48,
  padding: '0 20px',
  borderRadius: 14,
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 600,
  border: '1px solid rgba(255,255,255,0.08)',
}
