// /teacher/payments — thin redirect на /teacher/lessons?kind=payments.
// post-deploy bug bash 2026-06-19: контент перенесён в
// components/teacher/lessons/payments-section.tsx; legacy bookmarks +
// внешние email-ссылки работают через этот редирект. Auth gate
// отрабатывает в app/teacher/layout.tsx, дублировать не надо.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Оплаты — LevelChannel',
  robots: { index: false, follow: false },
}

export default function TeacherPaymentsRedirect() {
  redirect('/teacher/lessons?kind=payments')
}
