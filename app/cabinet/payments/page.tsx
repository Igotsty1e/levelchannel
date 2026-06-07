// teacher-payments-sbp-self-service Sub-PR C (2026-06-07).
//
// История оплат ученика. Доступ из футера /cabinet.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §4.2

import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/components/auth-shell'
import { SESSION_COOKIE_NAME, lookupSession } from '@/lib/auth/sessions'
import { listClaimsForLearner } from '@/lib/payments/sbp-claims'
import { Pill } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'История оплат — LevelChannel',
  robots: { index: false, follow: false },
}

function formatRub(kopecks: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(kopecks / 100)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function LearnerPaymentsHistoryPage() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
  if (!cookieValue) redirect('/login')
  const session = await lookupSession(cookieValue)
  if (!session) redirect('/login')

  const claims = await listClaimsForLearner(session.account.id, 100)

  return (
    <AuthShell>
      <div style={{ width: '100%', maxWidth: 640 }}>
        <Link
          href="/cabinet"
          style={{
            color: 'var(--secondary)',
            textDecoration: 'none',
            fontSize: 14,
            display: 'inline-block',
            marginBottom: 16,
          }}
        >
          ← Назад в кабинет
        </Link>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: 0,
            marginBottom: 8,
            letterSpacing: '-0.01em',
          }}
        >
          История оплат
        </h1>
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.6,
            margin: 0,
            marginBottom: 24,
          }}
        >
          Здесь видно, что вы заявили как оплаченное, что учитель подтвердил
          и что отклонил. Деньги идут напрямую учителю — платформа их
          не держит.
        </p>

        {claims.length === 0 ? (
          <div
            className="card"
            style={{
              padding: 24,
              color: 'var(--secondary)',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            Пока пусто. Когда вы оплатите занятие через кнопку «Оплатить»
            в карточке занятия, история появится здесь.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {claims.map((c) => {
              const pill = (() => {
                switch (c.status) {
                  case 'claimed':
                    return { label: 'Ждёт подтверждения', tone: 'warning' as const }
                  case 'confirmed':
                    return { label: 'Подтверждено', tone: 'success' as const }
                  case 'declined':
                    return { label: 'Не подтверждено', tone: 'danger' as const }
                  case 'cancelled':
                    return { label: 'Отменено', tone: 'default' as const }
                }
              })()
              return (
                <li key={c.id} className="card" style={{ padding: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        Учитель {c.teacherName}
                      </div>
                      <div
                        style={{
                          color: 'var(--secondary)',
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        Заявлено {formatDate(c.claimedAt)} ·{' '}
                        {c.paymentChannel === 'sbp' ? 'СБП' : 'Другой способ'}
                      </div>
                      {c.items.length > 0 ? (
                        <div
                          style={{
                            color: 'var(--secondary)',
                            fontSize: 13,
                            marginTop: 8,
                          }}
                        >
                          За: {c.items.map((it) => it.label).join('; ')}
                        </div>
                      ) : null}
                      {c.noteTeacher ? (
                        <div
                          style={{
                            color: 'var(--secondary)',
                            fontSize: 13,
                            marginTop: 6,
                          }}
                        >
                          Учитель: {c.noteTeacher}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                        {formatRub(c.amountKopecks)}
                      </div>
                      <Pill tone={pill.tone} size="sm">
                        {pill.label}
                      </Pill>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </AuthShell>
  )
}
