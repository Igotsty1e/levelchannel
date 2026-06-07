'use client'

// teacher-payments-sbp-self-service Sub-PR D extras (2026-06-07).
//
// «Должны оплатить» — список учеников с неоплаченными слотами +
// быстрая кнопка «Отметить оплачено» (mark-paid).

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/primitives'

type LearnerRow = {
  learnerId: string
  learnerName: string
  unpaidCount: number
  unpaidAmount: number
}

type MethodView = {
  id: string
  phoneDisplay: string
  bankLabel: string
  isDefault: boolean
}

type UnpaidSlot = {
  id: string
  label: string
  expectedKopecks: number
  startAt: string
  status: string
}

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(kopecks / 100)
}

export function UnpaidLearners({
  learners,
  methods,
}: {
  learners: LearnerRow[]
  methods: MethodView[]
}) {
  const router = useRouter()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [slots, setSlots] = useState<Record<string, UnpaidSlot[]>>({})
  const [selectedSlots, setSelectedSlots] = useState<Record<string, Set<string>>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const defaultMethod = methods.find((m) => m.isDefault) ?? methods[0] ?? null
  const [methodId, setMethodId] = useState<string | null>(defaultMethod?.id ?? null)
  const [channel, setChannel] = useState<'sbp' | 'other'>('sbp')

  useEffect(() => {
    if (!expandedId || slots[expandedId]) return
    void (async () => {
      try {
        const r = await fetch(
          `/api/teacher/payment-claims/unpaid-slots?learner=${encodeURIComponent(expandedId)}`,
          { cache: 'no-store' },
        )
        if (!r.ok) {
          setErr('Не удалось загрузить список слотов.')
          return
        }
        const body = await r.json()
        setSlots((prev) => ({ ...prev, [expandedId]: body.slots ?? [] }))
        setSelectedSlots((prev) => ({
          ...prev,
          [expandedId]:
            prev[expandedId] ?? new Set((body.slots ?? []).map((s: UnpaidSlot) => s.id)),
        }))
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'unknown')
      }
    })()
  }, [expandedId, slots])

  function toggleSlot(learnerId: string, slotId: string) {
    setSelectedSlots((prev) => {
      const cur = new Set(prev[learnerId] ?? [])
      if (cur.has(slotId)) cur.delete(slotId)
      else cur.add(slotId)
      return { ...prev, [learnerId]: cur }
    })
  }

  async function markPaid(learnerId: string) {
    const selected = selectedSlots[learnerId]
    if (!selected || selected.size === 0) {
      setErr('Выберите хотя бы один слот.')
      return
    }
    const learnerSlots = slots[learnerId] ?? []
    const items = learnerSlots
      .filter((s) => selected.has(s.id))
      .map((s) => ({
        slotId: s.id,
        expectedAmountKopecks: s.expectedKopecks,
      }))
    const total = items.reduce((a, it) => a + it.expectedAmountKopecks, 0)

    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const r = await fetch('/api/teacher/payment-claims/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerAccountId: learnerId,
          amountKopecks: total,
          paymentChannel: channel,
          paymentMethodId: channel === 'sbp' ? methodId : null,
          items,
        }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        setErr(data?.error || `HTTP ${r.status}`)
        return
      }
      setInfo(`Отмечено как оплачено: ${formatRub(total)}.`)
      setExpandedId(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        Должны оплатить
      </h2>
      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 16 }}>
        Если ученик уже заплатил (или заплатил наличными / другим способом),
        отметьте занятия как оплаченные — они исчезнут из этого списка.
      </p>

      {info ? (
        <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 12 }}>
          {info}
        </p>
      ) : null}
      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {err}
        </p>
      ) : null}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {learners.map((l) => {
          const isExpanded = expandedId === l.learnerId
          const learnerSlots = slots[l.learnerId] ?? []
          const selected = selectedSlots[l.learnerId] ?? new Set()
          return (
            <li
              key={l.learnerId}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {l.learnerName}
                  </div>
                  <div style={{ color: 'var(--secondary)', fontSize: 12, marginTop: 2 }}>
                    {l.unpaidCount} занятий · {formatRub(l.unpaidAmount)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : l.learnerId)
                  }
                  disabled={busy}
                >
                  {isExpanded ? 'Свернуть' : 'Отметить оплачено'}
                </Button>
              </div>
              {isExpanded ? (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  {learnerSlots.length === 0 ? (
                    <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
                      Загружаем…
                    </p>
                  ) : (
                    <>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                        {learnerSlots.map((s) => (
                          <li key={s.id}>
                            <label
                              style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                                fontSize: 13,
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selected.has(s.id)}
                                onChange={() => toggleSlot(l.learnerId, s.id)}
                                disabled={busy}
                              />
                              <span style={{ flex: 1 }}>{s.label}</span>
                              <span style={{ color: 'var(--secondary)' }}>
                                {formatRub(s.expectedKopecks)}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>

                      <div
                        style={{
                          marginTop: 12,
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <label style={{ fontSize: 13 }}>
                          Способ:{' '}
                          <select
                            value={channel}
                            onChange={(e) =>
                              setChannel(e.target.value as 'sbp' | 'other')
                            }
                            disabled={busy}
                            style={selectStyle}
                          >
                            <option value="sbp">СБП</option>
                            <option value="other">Другой</option>
                          </select>
                        </label>
                        {channel === 'sbp' && methods.length > 0 ? (
                          <label style={{ fontSize: 13 }}>
                            Метод:{' '}
                            <select
                              value={methodId ?? ''}
                              onChange={(e) => setMethodId(e.target.value)}
                              disabled={busy}
                              style={selectStyle}
                            >
                              {methods.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.phoneDisplay} · {m.bankLabel}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        <Button
                          size="sm"
                          onClick={() => markPaid(l.learnerId)}
                          disabled={busy || selected.size === 0}
                        >
                          {busy ? 'Сохраняем…' : 'Отметить оплачено'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '4px 8px',
  color: 'var(--text)',
  fontSize: 13,
}
