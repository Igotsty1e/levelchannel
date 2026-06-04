// Teacher onboarding: empty-state hint on /teacher/tariffs explaining
// what a "тариф" is + the snapshot-immutability behaviour.
//
// Per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.1`
// (`teacher-tariff-first-create-hint` slot).
//
// Trigger: SSR — render when teacher has 0 active tariffs AND the
// hint is not dismissed. Auto-dismisses (no need for the user to
// click ✕) once the first tariff is created — the next page render
// no longer matches the trigger predicate.

import { TariffFirstCreateHintDismissButton } from './tariff-first-create-hint-dismiss'

export function TariffFirstCreateHint({
  hasTariff,
  dismissed,
}: {
  hasTariff: boolean
  dismissed: boolean
}) {
  if (hasTariff || dismissed) return null

  return (
    <section
      className="card"
      aria-labelledby="tariff-first-create-heading"
      style={{
        padding: 20,
        marginBottom: 24,
        background:
          'linear-gradient(180deg, rgba(110, 168, 254, 0.06), transparent)',
        border: '1px solid var(--accent, #6ea8fe)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <h2
          id="tariff-first-create-heading"
          style={{ fontSize: 16, fontWeight: 600, margin: 0 }}
        >
          Что такое цена занятия
        </h2>
        <TariffFirstCreateHintDismissButton />
      </div>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--secondary)',
          margin: 0,
        }}
      >
        Цена занятия — это сумма, которую вы получаете за одно проведённое
        занятие. После того как цена впервые используется в расписании,
        её сумма закрепляется в snapshot для всех будущих занятий по этой
        цене: новые занятия пересчитаются, но уже прошедшие — нет.
        Поэтому, если хотите поменять стоимость, надёжнее создать новую
        цену и архивировать старую.
      </p>
    </section>
  )
}

