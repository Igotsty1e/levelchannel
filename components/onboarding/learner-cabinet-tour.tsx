// Learner onboarding: 3-step welcome tour shown on first /cabinet
// visit per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.2`
// (`learner-first-cabinet-tour-3steps`).
//
// Trigger: SSR — render when:
//   - the learner has an assigned teacher (at least one active
//     learner_teacher_links row), AND
//   - lesson_completions count = 0 (no lesson completed yet), AND
//   - dismissed_hints.learner_cabinet_tour IS NULL.
//
// Dismiss: «Понятно» button → POST /api/onboarding/dismiss-hint with
// `hintKey: 'learner_cabinet_tour'`.

import Link from 'next/link'

import { LearnerCabinetTourDismissButton } from './learner-cabinet-tour-dismiss'

const STEPS: ReadonlyArray<{ title: string; href: string; cta: string }> = [
  {
    title: 'Купить пакет занятий',
    href: '/cabinet/packages',
    cta: 'Открыть пакеты',
  },
  {
    title: 'Выбрать удобное время',
    href: '/cabinet/book',
    cta: 'Открыть календарь',
  },
  {
    title: 'Подключить Telegram для напоминаний',
    href: '/cabinet/profile#telegram',
    cta: 'Настроить напоминания',
  },
]

export function LearnerCabinetTour({
  shouldRender,
}: {
  shouldRender: boolean
}) {
  if (!shouldRender) return null

  return (
    <section
      className="card"
      aria-labelledby="learner-tour-heading"
      style={{
        padding: 20,
        marginBottom: 24,
        background:
          'linear-gradient(180deg, rgba(110, 168, 254, 0.08), transparent)',
        border: '1px solid var(--accent, #6ea8fe)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2
          id="learner-tour-heading"
          style={{ fontSize: 17, fontWeight: 600, margin: 0 }}
        >
          С чего начать
        </h2>
        <LearnerCabinetTourDismissButton />
      </div>
      <ol
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          counterReset: 'lct',
        }}
      >
        {STEPS.map((step, idx) => (
          <li
            key={step.title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'var(--accent, #6ea8fe)',
                color: '#0a0c10',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </span>
            <span style={{ flex: 1 }}>{step.title}</span>
            <Link
              href={step.href}
              style={{
                color: 'var(--accent, #6ea8fe)',
                fontSize: 13,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {step.cta} →
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
