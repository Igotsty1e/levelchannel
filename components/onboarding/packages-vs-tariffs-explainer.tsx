// Teacher onboarding: empty-state explainer on /teacher/packages
// distinguishing «пакет» (предоплата за N занятий) vs «тариф» (postpaid
// цена одного занятия).
//
// Per `docs/plans/onboarding-tooltips-spec-2026-05-31.md §1.1`
// (`teacher-packages-vs-tariffs-explainer` slot).
//
// Trigger: SSR — render when teacher has 0 active packages AND the
// hint is not dismissed. Auto-hides after the first package is created.

import { PackagesVsTariffsExplainerDismissButton } from './packages-vs-tariffs-explainer-dismiss'

export function PackagesVsTariffsExplainer({
  hasPackage,
  dismissed,
}: {
  hasPackage: boolean
  dismissed: boolean
}) {
  if (hasPackage || dismissed) return null

  return (
    <section
      className="card"
      aria-labelledby="packages-vs-tariffs-heading"
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
          id="packages-vs-tariffs-heading"
          style={{ fontSize: 16, fontWeight: 600, margin: 0 }}
        >
          Пакеты и цены занятий — в чём разница
        </h2>
        <PackagesVsTariffsExplainerDismissButton />
      </div>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--secondary)',
          margin: '0 0 8px',
        }}
      >
        <strong>Пакет</strong> — предоплата за N занятий со скидкой
        (например, 8 занятий за стоимость 7). Ученик платит сразу, занятия
        потом списываются по факту посещения.
      </p>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--secondary)',
          margin: 0,
        }}
      >
        <strong>Цена занятия</strong> — стоимость одного занятия postpaid
        (платится отдельно за каждое). Можно использовать пакеты и цены
        одновременно: пакеты дают вам предсказуемый доход и скидку для
        ученика, цены — гибкость для разовых занятий.
      </p>
    </section>
  )
}
