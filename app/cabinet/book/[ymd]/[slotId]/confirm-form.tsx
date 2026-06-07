'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/primitives'

const MAX_AGENDA_CHARS = 1000

// BCS-B.frontend — Calendly screen 3 client island.
// Captures the optional agenda comment, POSTs to /api/slots/<id>/book,
// routes to /cabinet on success with an info banner ("you're booked").
//
// Failure modes the route surfaces:
//   - 409 not_open      → race; route back to time list
//   - 410 in_past       → slot expired during the flow; back to days
//   - 402 package_required / tariff_required → show the message
//   - others → display message text and let the user retry / go back

export function ConfirmForm({
  slotId,
  ymd,
  // SAAS-PIVOT Day 2 (2026-05-22) — when present, the confirm screen
  // forwards `?teacher=<teacherAccountId>` to /api/slots/<id>/book so
  // a multi-link learner doesn't 400 needs_teacher_picker on the POST.
  // The server has already validated that this slot's teacher is in
  // the learner's active link set (parent page guard), so passing it
  // through the query string here is safe.
  teacherAccountId,
}: {
  slotId: string
  ymd: string
  teacherAccountId?: string | null
}) {
  const router = useRouter()
  const [agenda, setAgenda] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const bookUrl = teacherAccountId
        ? `/api/slots/${slotId}/book?teacher=${encodeURIComponent(teacherAccountId)}`
        : `/api/slots/${slotId}/book`
      const res = await fetch(bookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agenda: agenda || undefined }),
      })
      if (res.ok) {
        // Success — go to cabinet, "Мои занятия" surfaces the new booking.
        router.push('/cabinet?booked=1')
        return
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }
      if (res.status === 409) {
        // Race — back to time list to pick another.
        router.push(`/cabinet/book/${ymd}`)
        return
      }
      if (res.status === 410) {
        router.push('/cabinet/book')
        return
      }
      setError(data.message || data.error || `Ошибка ${res.status}`)
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Сетевая ошибка')
    } finally {
      setBusy(false)
    }
  }

  const charsLeft = MAX_AGENDA_CHARS - agenda.length
  const overCap = charsLeft < 0

  return (
    <form onSubmit={submit}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          margin: '0 0 12px 0',
        }}
      >
        Что хотите проработать?
      </h2>
      <textarea
        value={agenda}
        onChange={(e) => setAgenda(e.target.value)}
        disabled={busy}
        placeholder="Например: разобрать Present Perfect, потренировать разговорную речь"
        rows={4}
        style={{
          width: '100%',
          padding: 12,
          fontSize: 14,
          fontFamily: 'inherit',
          background: 'var(--surface-2)',
          color: 'var(--text)',
          border: `1px solid ${overCap ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 8,
          resize: 'vertical',
          minHeight: 96,
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          fontSize: 11,
          color: overCap ? 'var(--danger)' : 'var(--secondary)',
          textAlign: 'right',
          marginTop: 4,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {agenda.length} / {MAX_AGENDA_CHARS}
      </div>

      {error ? (
        <p
          role="alert"
          style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}
        >
          {error}
        </p>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <Button
          type="submit"
          size="lg"
          fullWidth
          disabled={busy || overCap}
          loading={busy}
        >
          Записаться на занятие
        </Button>
      </div>
    </form>
  )
}
