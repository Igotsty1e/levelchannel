// Teacher-cabinet-polish (2026-05-23) — TASK-3 Sub-PR D.
//
// Server-rendered tile on the /teacher dashboard that previews the
// teacher's today_local lesson list (the same predicate the daily
// digest cron uses for the 08:00 email). No state, no client-side
// fetch — the page's SSR reads the helper and hands `preview` in.
//
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR D.

import Link from 'next/link'
import type { ReactNode } from 'react'

import type { TeacherDigestPreview } from '@/lib/notifications/teacher-digest-preview'

type Props = {
  preview: TeacherDigestPreview
  /**
   * Wave-2 polish (2026-06-16): подсекция «Не отмечены» — past booked
   * слоты без completion-row, рендерится отдельным компонентом
   * (`RecentPastCard embedded`). Если undefined / null — секция скрыта.
   */
  pastUnmarkedSection?: ReactNode
}

// Format YYYY-MM-DD as «7 июня» (current year) or «7 июня 2025» (other year).
function formatYmdRu(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  const sameYear = new Date().getUTCFullYear() === Number(y)
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date)
}

// Format an ISO start_at in the teacher's local tz as HH:mm.
function formatStartHHmm(startAtIso: string, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    return fmt.format(new Date(startAtIso))
  } catch {
    return startAtIso.slice(11, 16)
  }
}

export function DigestPreviewTile({ preview, pastUnmarkedSection }: Props) {
  const { slots, todayLocalYmd, teacherTz } = preview

  return (
    <section
      aria-label="Дайджест на сегодня"
      style={{
        padding: '14px 18px',
        background: 'rgba(155, 223, 155, 0.06)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        marginBottom: 16,
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 14 }}>
          Сегодня, {formatYmdRu(todayLocalYmd)}
        </strong>
        <Link
          href="/teacher/settings/digest"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            textDecoration: 'none',
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.2,
          }}
        >
          <span aria-hidden="true">⚙</span>
          Настроить
        </Link>
      </div>

      {slots.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--secondary)' }}>
          На сегодня занятий нет
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {slots.map((slot) => {
            const label =
              slot.learnerName?.trim() ||
              slot.learnerEmail?.trim() ||
              'Ученик'
            const time = formatStartHHmm(slot.startAt, teacherTz)
            const isPastBooked =
              slot.status === 'booked'
              && new Date(slot.startAt).getTime() < Date.now()
            const isFutureBooked =
              slot.status === 'booked'
              && new Date(slot.startAt).getTime() >= Date.now()
            return (
              <li
                key={slot.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {time}
                </span>
                <span aria-hidden="true">·</span>
                <span>{label}</span>
                {slot.zoomUrl ? (
                  <a
                    href={slot.zoomUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--text)',
                      textDecoration: 'underline',
                      fontSize: 13,
                    }}
                  >
                    Открыть Zoom
                  </a>
                ) : null}
                {/* 2026-06-17: status pills (читаются как status) +
                    quick-actions (читаются как action). Owner-feedback:
                    «Оплачено» как label кнопки путается со статусом. */}
                {slot.status === 'cancelled' ? (
                  <span
                    style={{
                      fontSize: 12,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(255, 138, 138, 0.15)',
                      color: '#ff8a8a',
                    }}
                  >
                    Отменён
                  </span>
                ) : null}
                {slot.status === 'completed' ? (
                  <span
                    style={{
                      fontSize: 12,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(155, 223, 155, 0.15)',
                      color: '#9bdf9b',
                    }}
                  >
                    Проведён
                  </span>
                ) : null}
                {isPastBooked ? (
                  // 2026-06-17 owner-feedback: показываем реальный
                  // status pill «Не оплачено» (как на /teacher/lessons)
                  // вместо одиночной ✓-галочки.
                  <span
                    style={{
                      fontSize: 12,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(255, 200, 130, 0.15)',
                      color: '#ffc882',
                      fontWeight: 500,
                    }}
                  >
                    Не оплачено
                  </span>
                ) : null}
                {/* Quick-actions: future → Перенести/Отменить;
                    past booked → «Отметить оплату» (был «Оплачено»). */}
                {isFutureBooked ? (
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <QuickLink href={`/teacher/calendar?focusSlot=${slot.id}`}>
                      Перенести
                    </QuickLink>
                    <QuickLink href={`/teacher/calendar?focusSlot=${slot.id}`}>
                      Отменить
                    </QuickLink>
                  </span>
                ) : null}
                {isPastBooked && slot.learnerAccountId ? (
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                    <QuickLink href={`/teacher/learners/${slot.learnerAccountId}/settle`}>
                      Отметить оплату
                    </QuickLink>
                  </span>
                ) : null}
                {false && slot.status === 'booked'
                && new Date(slot.startAt).getTime() < Date.now() ? (
                  /* 2026-06-12 payments-copy-and-states: auto-complete
                     cron отключён, поэтому past booked-слот висит как
                     «забронирован». 2026-06-17 — заменили мелкую ✓
                     на полноценный «Не оплачено» pill выше. Блок
                     оставлен закомментированным как историческая ссылка. */
                  <span
                    aria-label="Занятие уже прошло"
                    title="Занятие уже прошло"
                    style={{
                      fontSize: 14,
                      color: 'var(--secondary)',
                      lineHeight: 1,
                    }}
                  >
                    ✓
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {/* QuickLink стиль определён локально, чтобы не плодить class'ы. */}
      {pastUnmarkedSection ? (
        <>
          <hr
            style={{
              border: 0,
              borderTop: '1px solid var(--border)',
              margin: '12px 0',
            }}
            aria-hidden="true"
          />
          <div>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--secondary)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              Не отмечены
            </p>
            {pastUnmarkedSection}
            <Link
              href="/teacher/lessons"
              style={{
                fontSize: 13,
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              Все прошедшие занятия →
            </Link>
          </div>
        </>
      ) : null}
    </section>
  )
}

function QuickLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'transparent',
        color: 'var(--text)',
        textDecoration: 'none',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.2,
      }}
    >
      {children}
    </Link>
  )
}
