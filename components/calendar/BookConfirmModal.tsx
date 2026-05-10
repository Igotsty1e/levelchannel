'use client'

import { useState } from 'react'

import type { CalendarRow } from '@/lib/calendar/view-model'

// Wave B PR1 — learner-side click-to-book modal launched from the
// calendar. Reuses the existing POST /api/slots/[id]/book endpoint;
// the modal only renders details + a Book button when the slot kind
// is `open`. Other kinds (booked-self / booked-other / past-redacted)
// render read-only details with a hint pointing to «Мои уроки» for
// cancellation (Codex 2026-05-08 Wave B design: NO cancel surface
// inside the calendar — keeps 24h-rule ownership in one place).
//
// Wave B post-review — Codex flagged the calendar grid renders in
// MSK while non-MSK learners see "wrong" wall times. Pragmatic fix
// for v1: the grid stays in MSK (canonical for the teacher's
// schedule), and this modal shows the slot in BOTH MSK and the
// learner's display tz so they can confirm the actual local time
// before committing. Long-term: thread tz through view-model.

// Wave 18 — billing-preview banner inputs. Modal renders one of:
//   (a) "Будет списано 1 занятие из пакета X (осталось N)" if the
//       learner has an active package matching the slot's duration.
//   (b) "Постоплата: счёт будет выставлен после занятия" if
//       postpaid is allowed (and no matching package).
//   (c) "К оплате X ₽" — existing tariff fallback.
// This is purely informational; the actual billing path is decided
// server-side at booking time (lib/scheduling/slots.ts:bookSlot
// runs the same priority order). The preview is what the learner
// SHOULD expect; if anything diverges (race with admin flipping
// postpaid_allowed, package expiring), the server still wins and
// the modal will surface the error like before.
export type BookConfirmActivePackage = {
  id: string
  titleSnapshot: string
  durationMinutes: number
  countRemaining: number
  countInitial: number
  // expiresAt drives FIFO selection; the server (consumePackageUnit
  // in lib/billing/consumption.ts) consumes the row with the
  // earliest expires_at first. The preview must match.
  expiresAt: string
}

export type BookConfirmModalProps = {
  row: CalendarRow
  emailVerified: boolean
  // Learner's display tz (from `account_profiles.timezone`). When
  // it differs from MSK, the modal shows both wall times.
  learnerTimezone: string
  activePackages?: BookConfirmActivePackage[]
  postpaidAllowed?: boolean
  // When false, the server takes the legacy non-billing booking path
  // (BILLING_WAVE_ACTIVE !== 'true'); preview banner is hidden so
  // it can't lie about a package/postpaid that won't fire.
  billingWaveActive?: boolean
  onClose: () => void
  // Fired on 200 (success) — parent runs refetch + close.
  onBooked: () => void
  // Fired on 409 race (slot_taken / slot_not_open) — parent runs
  // refetch so the calendar no longer shows the slot as `open`.
  // Modal stays mounted so the user sees the inline error; they
  // close manually.
  onConflict: () => void
}

export function BookConfirmModal({
  row,
  emailVerified,
  learnerTimezone,
  activePackages,
  postpaidAllowed,
  billingWaveActive,
  onClose,
  onBooked,
  onConflict,
}: BookConfirmModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slot = row.slot
  const canBook = slot.kind === 'open' && 'id' in slot && slot.id !== undefined

  // Wave 18 — billing preview. Server-side priority in bookSlot:
  //   1. matching-duration package consumption (FIFO by expires_at asc),
  //   2. postpaid (if allowed),
  //   3. tariff-bound single payment (legacy).
  // Mirror the same priority + the same FIFO rule here so the preview
  // names the SAME package the server will actually consume. Use a
  // shallow copy before .sort() to avoid mutating the prop array.
  const matchingPackage =
    canBook && activePackages && activePackages.length > 0
      ? [...activePackages]
          .filter((p) => p.durationMinutes === slot.durationMinutes)
          .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0]
      : undefined

  // Codex Wave B post-review: surface the slot wall time in BOTH
  // MSK (canonical teacher schedule) AND the learner's local tz so
  // they confirm the right hour before booking. Skip the local
  // line when the learner's tz matches MSK (avoids redundancy).
  const showLearnerTz =
    learnerTimezone && learnerTimezone !== 'Europe/Moscow'
  const localStart = showLearnerTz
    ? formatHhmmInTz(slot.startAt, learnerTimezone)
    : null
  const localEnd = showLearnerTz
    ? formatHhmmInTz(
        new Date(
          new Date(slot.startAt).getTime() + slot.durationMinutes * 60_000,
        ).toISOString(),
        learnerTimezone,
      )
    : null

  async function handleBook() {
    if (!canBook) return
    if (!emailVerified) {
      setError('Подтвердите e-mail, чтобы записаться на занятие.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/slots/${slot.id}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body?.error === 'email_not_verified') {
          throw new Error('Подтвердите e-mail, чтобы записаться.')
        }
        // Wave 18 / Codex review — fire onConflict on ANY 409. The
        // server (app/api/slots/[id]/book/route.ts) returns a single
        // human Russian sentence in `error`, NOT the stable codes
        // slot_taken/slot_not_open the old check looked for. Match
        // by HTTP status now: 409 = race, calendar must refetch.
        if (res.status === 409) {
          onConflict()
          throw new Error(
            body?.message ||
              body?.error ||
              'Этот слот только что занят. Попробуйте другой.',
          )
        }
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      onBooked()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const isBookedSelf = slot.kind === 'booked-self'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-confirm-title"
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1f1f23',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 24,
          minWidth: 320,
          maxWidth: 440,
          color: '#e4e4e7',
        }}
      >
        <h2 id="book-confirm-title" style={{ fontSize: 18, marginBottom: 12 }}>
          Слот {row.startLabel} – {row.endLabel}{' '}
          <span style={{ fontSize: 12, color: '#71717a', fontWeight: 400 }}>
            (МСК)
          </span>
        </h2>
        <dl style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.7 }}>
          <Row label="Дата" value={row.dayYmd} />
          {showLearnerTz && localStart && localEnd ? (
            <Row
              label="Ваше время"
              value={`${localStart} – ${localEnd} (${learnerTimezone})`}
            />
          ) : null}
          <Row label="Длительность" value={`${slot.durationMinutes} мин`} />
          <Row label="Статус" value={statusLabel(slot.kind)} />
          {'tariffAmountKopecks' in slot &&
          slot.tariffAmountKopecks !== null &&
          slot.tariffAmountKopecks !== undefined ? (
            <Row
              label="Стоимость"
              value={`${(slot.tariffAmountKopecks / 100).toLocaleString('ru-RU')} ₽`}
            />
          ) : null}
        </dl>

        {isBookedSelf ? (
          <p
            style={{
              color: '#9ca3af',
              fontSize: 12,
              marginTop: 16,
              lineHeight: 1.5,
            }}
          >
            Это ваш слот. Отменить запись можно в разделе «Мои уроки» —
            не позднее, чем за 24 часа до начала.
          </p>
        ) : null}

        {canBook && billingWaveActive && matchingPackage ? (
          <BillingPreview
            tone="package"
            title="Будет списано занятие из пакета"
            body={
              `«${matchingPackage.titleSnapshot}»: после записи останется ` +
              `${matchingPackage.countRemaining - 1} из ${matchingPackage.countInitial}.`
            }
          />
        ) : canBook && billingWaveActive && postpaidAllowed ? (
          <BillingPreview
            tone="postpaid"
            title="Постоплата"
            body="Счёт будет выставлен после занятия. Оплата происходит в кабинете."
          />
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 6,
              color: '#fecaca',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 20,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={btnSecondary}
          >
            Закрыть
          </button>
          {canBook ? (
            <button
              type="button"
              onClick={handleBook}
              disabled={busy || !emailVerified}
              style={
                emailVerified ? btnPrimary : { ...btnPrimary, opacity: 0.5 }
              }
              title={
                emailVerified
                  ? undefined
                  : 'Подтвердите e-mail, чтобы записаться'
              }
            >
              {busy ? 'Записываем…' : 'Записаться'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <dt style={{ minWidth: 100, color: '#71717a' }}>{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatHhmmInTz(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    // Defensive fallback if the tz name is malformed (shouldn't
    // happen — `account_profiles.timezone` is allowlist-validated).
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
}

function statusLabel(kind: CalendarRow['slot']['kind']): string {
  switch (kind) {
    case 'open':
      return 'Свободен'
    case 'booked-self':
      return 'Ваш слот'
    case 'booked-other':
      return 'Занято'
    case 'booked-full':
      return 'Забронирован'
    case 'past-full':
    case 'past-redacted':
      return 'Прошедший'
  }
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#e4e4e7',
  cursor: 'pointer',
  fontSize: 13,
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(34, 197, 94, 0.18)',
  border: '1px solid rgba(34, 197, 94, 0.55)',
  borderRadius: 6,
  color: '#bbf7d0',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}

function BillingPreview({
  tone,
  title,
  body,
}: {
  tone: 'package' | 'postpaid'
  title: string
  body: string
}) {
  // Package preview = green (same accent used for primary actions),
  // postpaid preview = amber (informational, not an action).
  const palette =
    tone === 'package'
      ? {
          bg: 'rgba(34, 197, 94, 0.10)',
          border: 'rgba(34, 197, 94, 0.35)',
          color: '#bbf7d0',
        }
      : {
          bg: 'rgba(234, 179, 8, 0.10)',
          border: 'rgba(234, 179, 8, 0.35)',
          color: '#fde68a',
        }
  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 6,
        color: palette.color,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>{title}</strong>
      <span>{body}</span>
    </div>
  )
}
