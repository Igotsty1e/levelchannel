// Teacher-cabinet-polish (2026-05-23) — TASK-3 Sub-PR D.
//
// Server-rendered tile on the /teacher dashboard that previews the
// teacher's today_local lesson list (the same predicate the daily
// digest cron uses for the 08:00 email). No state, no client-side
// fetch — the page's SSR reads the helper and hands `preview` in.
//
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR D.

import Link from 'next/link'

import type { TeacherDigestPreview } from '@/lib/notifications/teacher-digest-preview'

type Props = {
  preview: TeacherDigestPreview
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

export function DigestPreviewTile({ preview }: Props) {
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
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
