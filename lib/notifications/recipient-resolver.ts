// Wave-A notification recipient resolver.
//
// Single source of truth для: «у этого account-а email + (опционально)
// TG chat_id, и role совпадает с заявленной callsite-ом».
//
// Self-review BLOCKER #1 fix: если callsite ошибочно передал teacher
// accountId с role='learner' — refuse dispatch через RoleMismatchError.
// Без этого ученик мог бы получить «учитель отменил ваше занятие»,
// предназначенное другому. Privacy / trust боундари.
//
// Source of truth для роли: account_roles table (role IN ('admin',
// 'teacher')). Ученик = account БЕЗ row в account_roles с role IN
// ('admin', 'teacher'). Совпадает с logic из
// `LEARNER_ARCHETYPE_CANDIDATE_WHERE_SQL` но мягче — мы не требуем
// email_verified_at для recipient (учитель может быть еще не verified
// и всё равно получать письма о cancel'ах своих учеников).

import { getDbPool } from '@/lib/db/pool'

export type RecipientRole = 'teacher' | 'learner'

export type ResolvedRecipient = {
  accountId: string
  role: RecipientRole
  email: string
  /** chat_id если TG bound; null иначе → channel='telegram' будет skipped. */
  telegramChatId: string | null
  /** Display name для template-ов (first_name + last_name). */
  displayName: string
}

export class RoleMismatchError extends Error {
  public readonly accountId: string
  public readonly expectedRole: RecipientRole
  public readonly actualIsTeacher: boolean
  constructor(
    accountId: string,
    expectedRole: RecipientRole,
    actualIsTeacher: boolean,
  ) {
    super(
      `notification/recipient/role_mismatch: expected ${expectedRole}, ` +
        `got is_teacher=${actualIsTeacher} for account ${accountId}`,
    )
    this.name = 'RoleMismatchError'
    this.accountId = accountId
    this.expectedRole = expectedRole
    this.actualIsTeacher = actualIsTeacher
  }
}

export async function resolveRecipient(
  accountId: string,
  expectedRole: RecipientRole,
): Promise<ResolvedRecipient> {
  const pool = getDbPool()
  const result = await pool.query<{
    email: string
    first_name: string | null
    last_name: string | null
    teacher_telegram_chat_id: string | null
    learner_telegram_chat_id: string | null
    is_teacher: boolean
  }>(
    `select
       a.email,
       a.first_name,
       a.last_name,
       a.teacher_telegram_chat_id,
       a.learner_telegram_chat_id,
       exists(
         select 1 from account_roles r
          where r.account_id = a.id
            and r.role in ('admin', 'teacher')
       ) as is_teacher
       from accounts a
      where a.id = $1
      limit 1`,
    [accountId],
  )
  const row = result.rows[0]
  if (!row) {
    throw new Error(`notification/recipient/not_found: ${accountId}`)
  }
  const actualIsTeacher = row.is_teacher
  const expectedIsTeacher = expectedRole === 'teacher'
  if (actualIsTeacher !== expectedIsTeacher) {
    throw new RoleMismatchError(accountId, expectedRole, actualIsTeacher)
  }

  const tgChatId =
    expectedRole === 'teacher'
      ? row.teacher_telegram_chat_id
      : row.learner_telegram_chat_id

  const displayName =
    [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
    row.email.split('@')[0]

  return {
    accountId,
    role: expectedRole,
    email: row.email,
    telegramChatId: tgChatId,
    displayName,
  }
}
