// /teacher/settings/cancel-policy — 2026-06-17.
//
// Owner-feedback: «нужно сделать настройку доступности отмены занятия
// без оплаты ... учитель мог сам выбрать ... от 0 до 48 часов
// (включая минуты)».
//
// SSR-страница: показывает текущее значение + форму. Сабмит идёт на
// POST /api/teacher/cancel-policy через клиентский компонент.

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { getTeacherCancelWindowMinutes } from '@/lib/scheduling/policy'

import { CancelPolicyForm } from './form'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Политика отмены — настройки учителя — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherCancelPolicyPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const minutes = await getTeacherCancelWindowMinutes(session.account.id)

  return (
    <div className="digest-page">
      <div className="digest-page-back">
        <Link href="/teacher/settings" className="digest-back-link">
          ← Назад в&nbsp;настройки
        </Link>
      </div>
      <header className="digest-page-header">
        <h1 className="digest-page-title">Окно отмены без оплаты</h1>
        <p className="digest-page-sub">
          За какое время до начала занятия ученик может отменить запись
          без последствий. Если позже — отмена считается «поздней»
          (учитель может списать стоимость). Можно ставить от 0 до 48
          часов с шагом в минуту. По умолчанию — 24 часа.
        </p>
      </header>

      <CancelPolicyForm initialMinutes={minutes} />
    </div>
  )
}
