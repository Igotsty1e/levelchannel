'use client'

import { useState } from 'react'

import type { PricingTariff } from '@/lib/pricing/tariffs'

// Single client island for the pricing page. Inline-editable rows +
// "add new" form. Server-rendered data comes through `initialTariffs`;
// after each successful API hit we reload the page rather than
// re-rendering optimistically — fewer edge cases.

export function TariffEditor({
  initialTariffs,
}: {
  initialTariffs: PricingTariff[]
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function postJson(
    method: 'POST' | 'PATCH',
    url: string,
    body: unknown,
  ) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErr(data?.error || `HTTP ${res.status}`)
        setBusy(false)
        return false
      }
      window.location.reload()
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
      setBusy(false)
      return false
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {err ? (
        <div
          style={{
            background: 'rgba(255, 138, 138, 0.08)',
            border: '1px solid #ff8a8a55',
            color: '#ffcfcf',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {err}
        </div>
      ) : null}

      {initialTariffs.map((t) => (
        <TariffRow
          key={t.id}
          tariff={t}
          onPatch={(patch) =>
            postJson('PATCH', `/api/admin/pricing/${t.id}`, patch)
          }
          busy={busy}
        />
      ))}

      <NewTariffForm
        onCreate={(input) => postJson('POST', '/api/admin/pricing', input)}
        busy={busy}
      />
    </div>
  )
}

function TariffRow({
  tariff,
  onPatch,
  busy,
}: {
  tariff: PricingTariff
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>
  busy: boolean
}) {
  const [titleRu, setTitleRu] = useState(tariff.titleRu)
  const [amountRub, setAmountRub] = useState(
    String((tariff.amountKopecks / 100).toFixed(2)),
  )
  const [isActive, setIsActive] = useState(tariff.isActive)
  const [order, setOrder] = useState(String(tariff.displayOrder))

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 16,
        opacity: tariff.isActive ? 1 : 0.55,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 140px 100px 80px',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div>
          <Label>Название</Label>
          <Input
            value={titleRu}
            onChange={(e) => setTitleRu(e.target.value)}
          />
          <p
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: 'var(--secondary)',
              marginTop: 4,
            }}
          >
            {tariff.slug}
          </p>
        </div>
        <div>
          <Label>Сумма, ₽</Label>
          <Input
            type="number"
            step="0.01"
            min="1"
            value={amountRub}
            onChange={(e) => setAmountRub(e.target.value)}
          />
        </div>
        <div>
          <Label>Сорт.</Label>
          <Input
            type="number"
            step="1"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </div>
        <div>
          <Label>&nbsp;</Label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            активен
          </label>
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onPatch({
              titleRu,
              amountKopecks: Math.round(Number(amountRub) * 100),
              displayOrder: Number(order),
              isActive,
            })
          }
          style={{
            padding: '6px 14px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Сохранить
        </button>
      </div>
    </div>
  )
}

function NewTariffForm({
  onCreate,
  busy,
}: {
  onCreate: (input: Record<string, unknown>) => Promise<boolean>
  busy: boolean
}) {
  const [slug, setSlug] = useState('')
  const [titleRu, setTitleRu] = useState('')
  const [amountRub, setAmountRub] = useState('3500')
  const [order, setOrder] = useState('0')

  return (
    <div
      style={{
        border: '1px dashed var(--border)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        Добавить тариф
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '180px 1fr 140px 80px auto',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <div>
          <Label>Slug</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="lesson-60min"
          />
        </div>
        <div>
          <Label>Название</Label>
          <Input
            value={titleRu}
            onChange={(e) => setTitleRu(e.target.value)}
            placeholder="Урок 60 минут"
          />
        </div>
        <div>
          <Label>Сумма, ₽</Label>
          <Input
            type="number"
            step="0.01"
            min="1"
            value={amountRub}
            onChange={(e) => setAmountRub(e.target.value)}
          />
        </div>
        <div>
          <Label>Сорт.</Label>
          <Input
            type="number"
            step="1"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onCreate({
              slug,
              titleRu,
              amountKopecks: Math.round(Number(amountRub) * 100),
              displayOrder: Number(order),
              isActive: true,
            })
          }
          style={{
            padding: '8px 14px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Создать
        </button>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: 'var(--secondary)',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '8px 10px',
        color: 'var(--text)',
        fontSize: 13,
        ...(props.style ?? {}),
      }}
    />
  )
}
