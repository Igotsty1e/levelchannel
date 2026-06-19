// Epic D — per-event × per-channel notification preferences (2026-06-18).
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic D.
//
// Контракт:
//   - isNotificationAllowed(account, event, channel) → true если default
//     ON или explicit запись `enabled = true`. False ТОЛЬКО если explicit
//     `enabled = false`. Это backward-compat: dispatcher продолжает
//     отправлять всё пока пользователь не выключит явно.
//   - listNotificationPreferences(account) → возвращает все записи (для
//     UI рендера матрицы).
//   - upsertNotificationPreference(account, event, channel, enabled) →
//     UPSERT в одну строку.

import { getDbPool } from '@/lib/db/pool'

export type NotificationChannel = 'email' | 'telegram' | 'push'

export type NotificationPreferenceRow = {
  accountId: string
  eventKind: string
  channel: NotificationChannel
  enabled: boolean
  updatedAt: string
}

/**
 * Backward-compat default: запись отсутствует = `enabled` ON.
 * False ТОЛЬКО если есть explicit row с `enabled = false`.
 */
export async function isNotificationAllowed(
  accountId: string,
  eventKind: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const pool = getDbPool()
  const r = await pool.query<{ enabled: boolean }>(
    `select enabled from notification_preferences
      where account_id = $1::uuid
        and event_kind = $2
        and channel = $3
      limit 1`,
    [accountId, eventKind, channel],
  )
  if (r.rows.length === 0) return true
  return r.rows[0].enabled === true
}

export async function listNotificationPreferences(
  accountId: string,
): Promise<NotificationPreferenceRow[]> {
  const pool = getDbPool()
  const r = await pool.query<{
    account_id: string
    event_kind: string
    channel: string
    enabled: boolean
    updated_at: string
  }>(
    `select account_id, event_kind, channel, enabled, updated_at::text
       from notification_preferences
      where account_id = $1::uuid
      order by event_kind, channel`,
    [accountId],
  )
  return r.rows.map((row) => ({
    accountId: row.account_id,
    eventKind: row.event_kind,
    channel: row.channel as NotificationChannel,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }))
}

export async function upsertNotificationPreference(
  accountId: string,
  eventKind: string,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  const pool = getDbPool()
  await pool.query(
    `insert into notification_preferences (account_id, event_kind, channel, enabled, updated_at)
       values ($1::uuid, $2, $3, $4, now())
       on conflict (account_id, event_kind, channel) do update
         set enabled = excluded.enabled,
             updated_at = now()`,
    [accountId, eventKind, channel, enabled],
  )
}

/**
 * UI-side каталог событий + русские лейблы. Хранится в коде (а не в БД),
 * потому что мы хотим контроль над copy в едином месте.
 *
 * Группировка по разделам — для рендера матрицы в /teacher/settings/notifications.
 */
export const NOTIFICATION_EVENT_CATALOG: ReadonlyArray<{
  group: string
  groupLabel: string
  items: ReadonlyArray<{ kind: string; label: string; desc: string }>
}> = [
  {
    group: 'schedule',
    groupLabel: 'Расписание',
    items: [
      {
        kind: 'LessonCancelledByLearner',
        label: 'Отмена занятия учеником',
        desc: 'Ученик отменил забронированный урок.',
      },
      {
        kind: 'LessonCancelledByTeacher',
        label: 'Отмена занятия вами',
        desc: 'Вы отменили урок ученика.',
      },
      {
        kind: 'LessonRescheduledByLearner',
        label: 'Перенос занятия учеником',
        desc: 'Ученик перенёс свой урок.',
      },
      {
        kind: 'LessonRescheduledByTeacher',
        label: 'Перенос занятия вами',
        desc: 'Вы перенесли урок ученика.',
      },
      {
        kind: 'LessonDirectlyAssignedByTeacher',
        label: 'Назначение урока',
        desc: 'Вы назначили урок ученику напрямую (без брони).',
      },
    ],
  },
  {
    group: 'payments',
    groupLabel: 'Оплаты',
    items: [
      {
        kind: 'LessonMarkedPaidByTeacher',
        label: 'Отметка об оплате',
        desc: 'Вы отметили оплату урока вне сервиса.',
      },
      {
        kind: 'SbpClaimSubmittedByLearner',
        label: 'Заявка на оплату вне сервиса',
        desc: 'Ученик подал заявку через СБП self-service.',
      },
      {
        kind: 'PaymentClaimConfirmed',
        label: 'Подтверждение оплаты',
        desc: 'Оператор подтвердил оплату по заявке ученика.',
      },
      {
        kind: 'PaymentClaimDeclined',
        label: 'Отклонение оплаты',
        desc: 'Оператор отклонил заявку на оплату.',
      },
      {
        kind: 'PaymentRefundIssued',
        label: 'Возврат средств',
        desc: 'Оператор оформил возврат по уроку.',
      },
    ],
  },
  {
    group: 'reminders',
    groupLabel: 'Напоминания',
    items: [
      {
        kind: 'LessonMarkedCompleteByTeacher',
        label: 'Отметка о проведённом уроке',
        desc: 'Вы отметили урок как проведённый.',
      },
      {
        kind: 'LessonMarkedNoShowByTeacher',
        label: 'Отметка «ученик не пришёл»',
        desc: 'Вы отметили урок как пропущенный учеником.',
      },
    ],
  },
] as const

export const NOTIFICATION_CHANNELS_UI: ReadonlyArray<{
  channel: NotificationChannel
  label: string
}> = [
  { channel: 'email', label: 'Email' },
  { channel: 'telegram', label: 'Telegram' },
  { channel: 'push', label: 'Push' },
] as const
