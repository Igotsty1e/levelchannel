import type { Metadata } from 'next'

import {
  LEGAL_BANK_ACCOUNT,
  LEGAL_BANK_BIK,
  LEGAL_BANK_NAME,
  LEGAL_OPERATOR_DISPLAY,
  LEGAL_OPERATOR_OGRN,
  LEGAL_OPERATOR_TAX_ID,
} from '@/lib/legal/public-profile'
import { TeacherLandingClient } from '@/components/home/teacher-landing-client'

// SAAS-PIVOT Epic 8 Day 7 (2026-05-22) — teacher-acquisition landing.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 8 + §5 Day 7.
//
// Per owner decision 2026-05-21 ("только для учителей"), the previous
// learner-targeted operator-instance landing is dropped entirely from
// `/`. Learners arrive at payment via `/pay` (preserved) or via a
// teacher-deep-link (`/t/<slug>/pay`, Epic 6).
//
// The server-side `landing_view` audit hook is intentionally NOT wired
// into `auth_audit_events` — the allowlist there is enforced via SQL
// CHECK + a TS const-tuple (lib/audit/auth-events.ts AUTH_AUDIT_EVENT_TYPES)
// and adding a marketing event to it would mix domains. Instead we
// emit a one-line server log on every render; the operator scrapes it
// from journald the same way as Next.js's own access lines.

export const metadata: Metadata = {
  title: 'LevelChannel для преподавателей — расписание, ученики и оплаты в одном кабинете',
  description:
    'Личный кабинет для преподавателей английского и репетиторов. Расписание, ученики, пакеты, балансы — без Excel и переписок. Бесплатный тариф навсегда.',
  keywords:
    'CRM для репетитора, расписание для преподавателя, онлайн-запись для репетитора, учёт оплат репетитора, кабинет преподавателя английского',
  openGraph: {
    title: 'LevelChannel — кабинет преподавателя',
    description:
      'Расписание, ученики, оплаты в одном кабинете. Free тариф навсегда. Регистрация за 2 минуты.',
    type: 'website',
  },
}

export default function HomePage() {
  // Server-side `landing_view` analytics hook (per plan §3 Epic 8
  // optional task 5). The `auth_audit_events` allowlist is purposefully
  // closed to authentication-domain events; we don't widen it for a
  // marketing impression. Stick to a structured stdout line so the
  // operator can grep journald for `[landing] view` to gauge traffic
  // pre-Plausible.
  console.log('[landing] view', {
    ts: new Date().toISOString(),
    page: '/',
    epic: 'saas-pivot-epic-8',
  })

  return (
    <TeacherLandingClient
      legalProfile={{
        legalBankAccount: LEGAL_BANK_ACCOUNT,
        legalBankBik: LEGAL_BANK_BIK,
        legalBankName: LEGAL_BANK_NAME,
        legalOperatorDisplay: LEGAL_OPERATOR_DISPLAY,
        legalOperatorTaxId: LEGAL_OPERATOR_TAX_ID,
        legalOperatorOgrn: LEGAL_OPERATOR_OGRN,
      }}
    />
  )
}
