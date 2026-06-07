import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { TeacherDangerCard } from '@/components/teacher/profile/danger-card'
import { TeacherProfileCard } from '@/components/teacher/profile/profile-card'
import { getAccountProfile } from '@/lib/auth/profiles'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'

// Deep UX redesign of /teacher/profile (2026-06-07).
//
// Previous structure: shared <ProfileEditor> + <DangerZone> from
// /cabinet/* (learner cabinet) rendered into a force-fit teacher page.
// That left us with an uppercase-label form, a 50-row timezone <select>
// by default, an always-open destructive panel, and inline button
// styles instead of the design-system primitive.
//
// This redesign keeps the learner cabinet's editor untouched and ships
// two teacher-scoped components instead:
//   - <TeacherProfileCard>  — name + timezone, ChipGroup for 4 quick
//                             Russian tzs + «Другой» falls back to the
//                             full <select>, live name preview, Save
//                             via Button primitive with dirty/loading
//                             state. enforceExplicitTimezone semantics
//                             baked in (teacher surface always).
//   - <TeacherDangerCard>   — collapsed by default; Banner + primitive
//                             Buttons; danger and secondary variants
//                             distinguish the two destructive paths.
//
// Backend contract unchanged (PATCH /api/account/profile, POST
// /api/account/consents/withdraw, POST /api/account/delete). No data
// shape changes. /teacher layout still gates auth + role + verified-
// email; this page only re-reads the session to surface the teacher's
// own account.id to the profile loader.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Профиль — LevelChannel',
  robots: { index: false, follow: false },
}

export default async function TeacherProfilePage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) {
    redirect('/login')
  }
  const current = await lookupSession(cookieValue)
  if (!current) {
    redirect('/login')
  }

  const { account } = current
  const profile = await getAccountProfile(account.id)

  return (
    <div className="pricing-page">
      <div className="pricing-page-back">
        <a href="/teacher/settings" className="pricing-back-link">
          ← Назад в настройки
        </a>
      </div>
      <header className="pricing-page-header">
        <h1 className="pricing-page-title">Профиль</h1>
        <p className="pricing-page-sub">
          Имя и часовой пояс — то, что видят ученики. E-mail и пароль
          живут в настройках безопасности (скоро).
        </p>
      </header>

      <TeacherProfileCard
        initialProfile={profile}
        fallbackEmail={account.email}
      />

      <TeacherDangerCard />
    </div>
  )
}
