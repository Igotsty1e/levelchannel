'use client'

// teacher-payments-sbp-self-service Sub-PR D extras.
// Учительская политика: считать ли долгом неявку ученика и поздние отмены.

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button, Checkbox } from '@/components/ui/primitives'
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
    <div className="card" style={{ padding: 24 }}>
      <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
        Политика по неоплаченным занятиям
      </h3>
      <p style={{ color: 'var(--secondary)', fontSize: 13, marginBottom: 16 }}>
        Эти настройки управляют, какие занятия попадают в раздел
        «Должны оплатить».
      </p>

      <div style={{ marginBottom: 12 }}>
        <Checkbox
          checked={chargeOnNoShow}
          onChange={setChargeOnNoShow}
          disabled={busy}
          label={<strong>Брать оплату, если ученик не пришёл</strong>}
          hint="Если ученик не пришёл без предупреждения — считать занятие долгом. По умолчанию выключено."
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Checkbox
          checked={chargeOnLateCancel}
          onChange={setChargeOnLateCancel}
          disabled={busy}
          label={<strong>Брать оплату при поздней отмене</strong>}
          hint="Если ученик отменил позже политики (по умолчанию 24 ч) — считать занятие долгом. По умолчанию выключено."
        />
      </div>

      {err ? (
        <div
          role="alert"
          aria-live="polite"
          style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}
        >
          {err}
        </div>
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
