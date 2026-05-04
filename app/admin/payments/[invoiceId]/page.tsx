import Link from 'next/link'
import { notFound } from 'next/navigation'

import { listPaymentAuditEventsByInvoice } from '@/lib/audit/payment-events'
import { listAllocationsForOrder } from '@/lib/payments/allocations'
import { getOrder } from '@/lib/payments/store'
import { getSlotById } from '@/lib/scheduling/slots'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ invoiceId: string }> }

export default async function AdminPaymentDetailPage({ params }: RouteParams) {
  const { invoiceId } = await params

  const order = await getOrder(invoiceId)
  if (!order) notFound()

  const [audit, allocations] = await Promise.all([
    listPaymentAuditEventsByInvoice(invoiceId),
    listAllocationsForOrder(invoiceId),
  ])

  // For each lesson_slot allocation, fetch the slot row so the page
  // can show "урок 5 мая в 18:00" instead of a raw uuid.
  const slotIds = allocations
    .filter((a) => a.kind === 'lesson_slot')
    .map((a) => a.targetId)
  const slots = await Promise.all(slotIds.map((id) => getSlotById(id)))
  const slotMap = new Map(
    slots
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => [s.id, s]),
  )

  const meta = order.metadata ?? {}
  const slotIdInMeta =
    typeof meta.slotId === 'string' && meta.slotId ? meta.slotId : null

  return (
    <>
      <p style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/admin/payments" style={{ color: 'var(--secondary)' }}>
          ← К списку платежей
        </Link>
      </p>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          marginBottom: 16,
          fontFamily: 'monospace',
        }}
      >
        {order.invoiceId}
      </h1>

      <Section title="Заказ">
        <Field label="Сумма">
          {new Intl.NumberFormat('ru-RU').format(order.amountRub)}\u00a0
          {order.currency}
        </Field>
        <Field label="Статус">{order.status}</Field>
        <Field label="Провайдер">{order.provider}</Field>
        <Field label="E-mail клиента">{order.customerEmail}</Field>
        <Field label="Создан">{formatDateTime(order.createdAt)}</Field>
        <Field label="Обновлён">{formatDateTime(order.updatedAt)}</Field>
        {order.paidAt ? (
          <Field label="Оплачен">{formatDateTime(order.paidAt)}</Field>
        ) : null}
        {order.failedAt ? (
          <Field label="Отклонён">{formatDateTime(order.failedAt)}</Field>
        ) : null}
        {order.providerMessage ? (
          <Field label="Сообщение провайдера">{order.providerMessage}</Field>
        ) : null}
        {order.customerComment ? (
          <Field label="Комментарий клиента">{order.customerComment}</Field>
        ) : null}
        {slotIdInMeta ? (
          <Field label="Slot id (в metadata)">
            <code style={{ fontSize: 11 }}>{slotIdInMeta}</code>
          </Field>
        ) : null}
      </Section>

      <Section title="Привязки (payment_allocations)">
        {allocations.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Нет привязок. Если slotId был в metadata, но строки нет —
            возможно webhook ещё не дошёл, или allocation insert упал
            (ищите в журнале <code>[allocations]</code>).
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {allocations.map((a) => {
              const slot = slotMap.get(a.targetId)
              return (
                <li
                  key={`${a.kind}:${a.targetId}`}
                  style={{
                    padding: '8px 0',
                    borderTop: '1px solid var(--border)',
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: 'var(--secondary)' }}>{a.kind}:</span>{' '}
                  {slot ? (
                    <>
                      <Link
                        href={`/admin/slots`}
                        style={{ color: 'var(--text)' }}
                      >
                        {formatDateTime(slot.startAt)} ·{' '}
                        {slot.durationMinutes} мин
                      </Link>{' '}
                      <span style={{ color: 'var(--secondary)' }}>
                        ({slot.status} ·{' '}
                        {(a.amountKopecks / 100).toLocaleString('ru-RU')}\u00a0₽)
                      </span>
                    </>
                  ) : (
                    <code style={{ fontSize: 11 }}>{a.targetId}</code>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Аудит (payment_audit_events)">
        {audit.length === 0 ? (
          <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Нет событий.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {audit.map((e) => (
              <li
                key={e.id}
                style={{
                  padding: '8px 0',
                  borderTop: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {e.eventType}
                </div>
                <div
                  style={{
                    color: 'var(--secondary)',
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  {formatDateTime(e.createdAt)} · {e.actor}
                  {e.fromStatus && e.toStatus ? (
                    <>
                      {' '}
                      · {e.fromStatus} → {e.toStatus}
                    </>
                  ) : e.toStatus ? (
                    <> · → {e.toStatus}</>
                  ) : null}
                </div>
                {e.payload && Object.keys(e.payload).length > 0 ? (
                  <pre
                    style={{
                      fontSize: 10,
                      color: 'var(--secondary)',
                      marginTop: 4,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {order.events.length > 0 ? (
        <Section title="Внутренний event-лог ордера">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {order.events.slice(0, 20).map((e, idx) => (
              <li
                key={`${e.at}:${idx}`}
                style={{
                  padding: '8px 0',
                  borderTop: '1px solid var(--border)',
                  fontSize: 12,
                }}
              >
                <span style={{ fontFamily: 'monospace' }}>{e.type}</span>{' '}
                <span style={{ color: 'var(--secondary)' }}>
                  · {formatDateTime(e.at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: 12,
        fontSize: 13,
        marginBottom: 6,
      }}
    >
      <span style={{ color: 'var(--secondary)' }}>{label}</span>
      <span>{children}</span>
    </div>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
}
