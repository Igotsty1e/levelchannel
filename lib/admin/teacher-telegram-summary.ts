// BCS-DEF-5-TG (2026-05-21) — admin-side read helper for the teacher
// Telegram channel summary widget.
//
// Plan: docs/plans/bcs-def-5-tg-teacher-telegram-reminders.md §2.7.

import { getAuthPool } from '@/lib/auth/pool'
import { isUndefinedColumnError, isUndefinedTableError } from '@/lib/db/errors'

export type TeacherTelegramSummary =
  | { kind: 'ready'; activeBindings: number; botTokenPresent: boolean }
  | { kind: 'migration_pending' }

export async function getTeacherTelegramSummary(): Promise<TeacherTelegramSummary> {
  const botTokenPresent =
    typeof process.env.TELEGRAM_BOT_TOKEN === 'string'
    && process.env.TELEGRAM_BOT_TOKEN.trim().length > 0
  try {
    const pool = getAuthPool()
    const r = await pool.query<{ n: string }>(
      `select count(*)::text as n
         from accounts
        where teacher_telegram_enabled = true
          and teacher_telegram_chat_id is not null`,
    )
    const activeBindings = Number(r.rows[0]?.n ?? '0')
    return { kind: 'ready', activeBindings, botTokenPresent }
  } catch (err) {
    if (isUndefinedTableError(err) || isUndefinedColumnError(err)) {
      return { kind: 'migration_pending' }
    }
    throw err
  }
}
