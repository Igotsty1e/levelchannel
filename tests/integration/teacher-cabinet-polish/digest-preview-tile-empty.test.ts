// Teacher-cabinet-polish (2026-05-23) — TASK-3 Sub-PR D.
//
// Empty-state test: a teacher with NO booked slots in today_local
// gets `slots: []`. Confirms the helper returns a well-formed
// todayLocalYmd + teacherTz even on the empty branch (so the tile
// renders "На сегодня уроков нет" without a NaN date).

import { describe, expect, it } from 'vitest'

import { createAccount, grantAccountRole, normalizeAccountEmail } from '@/lib/auth/accounts'
import { hashPassword } from '@/lib/auth/password'
import { getDbPool } from '@/lib/db/pool'
import { getTeacherDigestPreview } from '@/lib/notifications/teacher-digest-preview'

import '../setup'

async function makeTeacher(emailPrefix: string, timezone: string | null): Promise<string> {
  const acc = await createAccount({
    email: normalizeAccountEmail(
      `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    ),
    passwordHash: await hashPassword('StrongPassword123'),
  })
  await grantAccountRole(acc.id, 'teacher', null)
  // Insert profile only when timezone is supplied; for null-tz path we
  // skip profile creation so the helper exercises its
  // 'Europe/Moscow' default branch.
  if (timezone !== null) {
    await getDbPool().query(
      `insert into account_profiles (account_id, timezone)
         values ($1::uuid, $2)
       on conflict (account_id) do update
         set timezone = excluded.timezone, updated_at = now()`,
      [acc.id, timezone],
    )
  }
  return acc.id
}

describe('getTeacherDigestPreview — empty today list', () => {
  it('teacher with no booked slots → empty slots + valid metadata', async () => {
    const teacherId = await makeTeacher('digest-preview-empty', 'Europe/Moscow')

    const preview = await getTeacherDigestPreview(teacherId)

    expect(preview.slots).toEqual([])
    expect(preview.teacherTz).toBe('Europe/Moscow')
    expect(preview.todayLocalYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('teacher with NULL timezone falls back to Europe/Moscow', async () => {
    const teacherId = await makeTeacher('digest-preview-null-tz', null)

    const preview = await getTeacherDigestPreview(teacherId)

    expect(preview.teacherTz).toBe('Europe/Moscow')
    expect(preview.slots).toEqual([])
    expect(preview.todayLocalYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
