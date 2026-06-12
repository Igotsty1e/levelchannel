'use client'

// teacher-payments-sbp-self-service Sub-PR D extras.
// Учительская политика: считать ли долгом неявку ученика и поздние отмены.

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/primitives'
import { localizeTeacherError } from '@/lib/i18n/teacher-errors'

export function PolicyEditor({
  initial,
}: {
  initial: { chargeOnNoShow: boolean; chargeOnLateCancel: boolean }
}) {
  const router = useRouter()
  const [chargeOnNoShow, setChargeOnNoShow] = useState(initial.chargeOnNoShow)
  const [chargeOnLateCancel, setChargeOnLateCancel] = useState(
    initial.chargeOnLateCancel,
  )
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const dirty =
    chargeOnNoShow !== initial.chargeOnNoShow
    || chargeOnLateCancel !== initial.chargeOnLateCancel

  async function save() {
    if (busy) return
    setBusy(true)
    setErr(null)
    setInfo(null)
    try {
      const r = await fetch('/api/teacher/payment-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chargeOnNoShow, chargeOnLateCancel }),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => ({}))
        setErr(
          localizeTeacherError(data?.error)
            ?? 'Не удалось сохранить настройки.',
        )
        return
      }
      setInfo('Сохранено.')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
        Политика по неоплаченным занятиям
      </h2>
      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 16 }}>
        Эти настройки управляют, какие занятия попадают в раздел
        «Должны оплатить».
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          cursor: 'pointer',
          marginBottom: 12,
        }}
      >
        <input
          type="checkbox"
          checked={chargeOnNoShow}
          onChange={(e) => setChargeOnNoShow(e.target.checked)}
          disabled={busy}
          style={{ marginTop: 4 }}
        />
        <span style={{ fontSize: 14, lineHeight: 1.5 }}>
          <strong>Брать оплату, если ученик не пришёл</strong>
          <br />
          <span style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Если ученик не пришёл без предупреждения — считать занятие
            долгом. По умолчанию выключено.
          </span>
        </span>
      </label>

      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          cursor: 'pointer',
          marginBottom: 16,
        }}
      >
        <input
          type="checkbox"
          checked={chargeOnLateCancel}
          onChange={(e) => setChargeOnLateCancel(e.target.checked)}
          disabled={busy}
          style={{ marginTop: 4 }}
        />
        <span style={{ fontSize: 14, lineHeight: 1.5 }}>
          <strong>Брать оплату при поздней отмене</strong>
          <br />
          <span style={{ color: 'var(--secondary)', fontSize: 13 }}>
            Если ученик отменил позже политики (по умолчанию 24 ч) —
            считать занятие долгом. По умолчанию выключено.
          </span>
        </span>
      </label>

      {err ? (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>
          {err}
        </p>
      ) : null}
      {info ? (
        <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 8 }}>
          {info}
        </p>
      ) : null}

      <Button onClick={save} disabled={busy || !dirty}>
        {busy ? 'Сохраняем…' : 'Сохранить'}
      </Button>
    </div>
  )
}
