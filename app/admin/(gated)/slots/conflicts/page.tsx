import Link from 'next/link'

import {
  isAuditTablePresent,
  listAdminConflicts,
  type AdminConflict,
} from '@/lib/admin/conflict-feed'

import { ConflictsActionsCell } from './_components/actions-cell'

// BCS-DEF-2 — /admin/slots/conflicts operator dashboard.
//
// Plan: docs/plans/conflict-feed.md §3.5 (round-3 SIGN-OFF,
// 2026-05-19). Server-rendered. Lists every booked slot with a non-
// null `external_conflict_at` in the last 30 days (or all-time via
// `?window=all`).
//
// Two inline actions per row (Dismiss + Cancel-from-conflict) — Move
// dropped per §0a (detector only stamps booked slots, move route is
// open-only).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Конфликты с Google-календарём. Админка',
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

type PageProps = {
  searchParams: Promise<{ window?: string }>
}

export default async function AdminConflictsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const allTime = sp.window === 'all'
  const since = allTime ? null : new Date(Date.now() - THIRTY_DAYS_MS)

  const [conflicts, auditTablePresent] = await Promise.all([
    listAdminConflicts({ since }),
    isAuditTablePresent(),
  ])

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>
          Конфликты с Google-календарём
        </h1>
        <Link
          href={allTime ? '/admin/slots/conflicts' : '/admin/slots/conflicts?window=all'}
          style={{
            fontSize: 13,
            color: 'var(--accent)',
            textDecoration: 'none',
          }}
        >
          {allTime ? 'За 30 дней' : 'Все время'}
        </Link>
      </div>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 20,
          maxWidth: 720,
        }}
      >
        Здесь — забронированные занятия, для которых post-pull детектор
        нашёл пересечение с внешним событием в Google-календаре учителя.
        Оператор может снять конфликт (если уверен, что разрулится сам)
        или отменить занятие. Учителю видна красная плашка в его
        кабинете — действия здесь не заменяют её, а добавляют второй
        канал решения. Окно по умолчанию — 30 дней.
      </p>

      {!auditTablePresent ? (
        <div
          style={{
            padding: '12px 16px',
            border: '1px solid #c97a00',
            background: '#fff7e6',
            borderRadius: 8,
            marginBottom: 16,
            color: '#1f1f1f',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Журнал действий оператора недоступен до миграции 0062.</strong>{' '}
          Сами действия (снять конфликт / отменить занятие) работают; их
          канонический след пишется в <code>lesson_slots.events</code>{' '}
          вместе с самим изменением. Вторичный журнал{' '}
          <code>slot_admin_actions</code> начнёт писаться после{' '}
          <code>npm run migrate:up</code> на VPS.
        </div>
      ) : null}

      {conflicts.length === 0 ? (
        <div
          style={{
            padding: '20px 24px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            borderRadius: 8,
            color: 'var(--secondary)',
            fontSize: 14,
          }}
        >
          {allTime
            ? 'Конфликтов нет (за всё время).'
            : 'Конфликтов за последние 30 дней нет.'}
        </div>
      ) : (
        <ConflictsTable rows={conflicts} />
      )}
    </>
  )
}

function ConflictsTable({ rows }: { rows: AdminConflict[] }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
        overflow: 'auto',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ background: 'var(--bg)' }}>
            <Th>Учитель</Th>
            <Th>Учащийся</Th>
            <Th>Начало</Th>
            <Th>Длит.</Th>
            <Th>Тип конфликта</Th>
            <Th>Источник (cal / event)</Th>
            <Th>Стамп</Th>
            <Th>ID занятия</Th>
            <Th>Действия</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.slotId}
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <Td>
                <Link
                  href={`/admin/accounts/${encodeURIComponent(row.teacherAccountId)}`}
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}
                >
                  {row.teacherEmail || row.teacherAccountId}
                </Link>
              </Td>
              <Td>
                {row.learnerEmail
                  ? row.learnerEmail
                  : <span style={{ color: 'var(--secondary)' }}>—</span>}
              </Td>
              <Td>
                <div style={{ whiteSpace: 'nowrap' }}>{formatMsk(row.startAt)}</div>
                <div style={{ color: 'var(--secondary)', fontSize: 11 }}>
                  UTC {formatUtc(row.startAt)}
                </div>
              </Td>
              <Td>{row.durationMinutes} мин</Td>
              <Td>
                <code style={{ fontSize: 12 }}>
                  {row.externalConflictKind ?? '—'}
                </code>
              </Td>
              <Td>
                {row.conflictSourceCalendarId || row.conflictSourceEventId ? (
                  <>
                    <div
                      title={row.conflictSourceCalendarId ?? ''}
                      style={{
                        fontSize: 11,
                        color: 'var(--secondary)',
                        maxWidth: 180,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {truncateId(row.conflictSourceCalendarId)}
                    </div>
                    <div
                      title={row.conflictSourceEventId ?? ''}
                      style={{
                        fontSize: 11,
                        color: 'var(--secondary)',
                        maxWidth: 180,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {truncateId(row.conflictSourceEventId)}
                    </div>
                  </>
                ) : (
                  <span style={{ color: 'var(--secondary)' }}>—</span>
                )}
              </Td>
              <Td>
                <span
                  title={row.externalConflictAt}
                  style={{ fontSize: 11, color: 'var(--secondary)' }}
                >
                  {formatMsk(row.externalConflictAt)}
                </span>
              </Td>
              <Td>
                <code style={{ fontSize: 11 }}>{row.slotId.slice(0, 8)}</code>
              </Td>
              <Td>
                <ConflictsActionsCell slotId={row.slotId} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '10px 12px',
        textAlign: 'left',
        fontSize: 12,
        color: 'var(--secondary)',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: '10px 12px',
        verticalAlign: 'top',
      }}
    >
      {children}
    </td>
  )
}

function truncateId(id: string | null): string {
  if (!id) return '—'
  if (id.length <= 24) return id
  return `${id.slice(0, 12)}…`
}

const MSK_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const UTC_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatMsk(iso: string): string {
  try {
    return MSK_FORMATTER.format(new Date(iso))
  } catch {
    return iso
  }
}

function formatUtc(iso: string): string {
  try {
    return UTC_FORMATTER.format(new Date(iso))
  } catch {
    return iso
  }
}
