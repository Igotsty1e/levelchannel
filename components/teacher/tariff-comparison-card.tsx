// Teacher cabinet polish — Sub-PR C (TASK-2).
//
// Plan: docs/plans/teacher-cabinet-polish.md §3 Sub-PR C.
//
// Server component (no client state, no event handlers). Renders the
// 4-tier `teacher_subscription_plans` catalogue side-by-side so the
// teacher can see what each plan offers AND which one they're on
// today. The "Сменить тариф" button is intentionally DISABLED across
// all 4 cards in this sub-PR — public plan-flip is still deferred to
// the saas-pivot Epic 4-DEFERRED. Q-4 closure: plain HTML `title`
// attribute for the hover hint, no JS-driven popover.
//
// Current-plan badge: the matching card carries a "● Текущий тариф"
// label in the accent colour. The match is on slug; if the teacher
// has no teacher_subscriptions row yet (legacy / mid-migration),
// the caller passes `currentPlanSlug='free'` so the Free card still
// gets the badge — the formatProfileName-equivalent of a sensible
// default rather than a blank no-current state.

import type { CSSProperties } from 'react'

export type TariffComparisonPlan = {
  slug: string
  titleRu: string
  priceKopecksMonthly: number
  /** NULL = unlimited (operator-managed only). */
  learnerLimit: number | null
  /**
   * jsonb blob from teacher_subscription_plans.features. Forward-
   * compatible: today no callers read this, but `google_calendar` /
   * `tg_reminders` / `money_flow_through_platform` are reserved keys
   * (see mig 0073 header comment). Render at most 2 readable feature
   * lines if known keys are present.
   */
  features: Record<string, unknown>
}

type Props = {
  plans: ReadonlyArray<TariffComparisonPlan>
  /** Slug of the teacher's current plan (FK to plans.slug). */
  currentPlanSlug: string
}

// Stable display order. The DB doesn't sort; we sort here so the
// cards always appear left-to-right Free → Mid → Pro → Operator.
const PLAN_ORDER: ReadonlyArray<string> = [
  'free',
  'mid',
  'pro',
  'operator-managed',
]

function orderPlans(
  plans: ReadonlyArray<TariffComparisonPlan>,
): TariffComparisonPlan[] {
  const byIndex = new Map<string, number>()
  PLAN_ORDER.forEach((slug, i) => byIndex.set(slug, i))
  return [...plans].sort((a, b) => {
    const ai = byIndex.get(a.slug) ?? Number.MAX_SAFE_INTEGER
    const bi = byIndex.get(b.slug) ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.slug.localeCompare(b.slug)
  })
}

function formatPrice(priceKopecksMonthly: number): string {
  if (priceKopecksMonthly === 0) return 'Бесплатно'
  // kopecks → roubles (integer division is fine; all DB rows are
  // whole-rouble amounts: 0 / 30000 / 80000 / 0).
  const rubles = Math.round(priceKopecksMonthly / 100)
  return `${rubles}₽/мес`
}

function formatLearnerLimit(learnerLimit: number | null): string {
  if (learnerLimit === null) return 'Без ограничений'
  // "До 1 ученика" / "До 5 учеников" / "До 30 учеников". Russian
  // pluralisation: 1 → ученика, 2-4 → ученика (genitive-singular),
  // 5+ → учеников. The Free tier is 1 → "До 1 ученика".
  const mod10 = learnerLimit % 10
  const mod100 = learnerLimit % 100
  let noun: string
  if (mod10 === 1 && mod100 !== 11) {
    noun = 'ученика'
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    noun = 'ученика'
  } else {
    noun = 'учеников'
  }
  return `До ${learnerLimit} ${noun}`
}

/**
 * Pretty-print up to 2 feature lines from the jsonb blob. Only known
 * reserved keys are surfaced — unknown keys are silently ignored so a
 * future schema bump can ship feature flags without immediately
 * changing the comparison-card UI.
 */
function formatFeatureLines(features: Record<string, unknown>): string[] {
  const lines: string[] = []
  if (features.money_flow_through_platform === true) {
    lines.push('Платежи через платформу')
  }
  if (features.google_calendar === true) {
    lines.push('Google Calendar')
  }
  if (features.tg_reminders === true) {
    lines.push('Напоминания в Telegram')
  }
  return lines.slice(0, 2)
}

export function TariffComparisonCard({
  plans,
  currentPlanSlug,
}: Props) {
  const ordered = orderPlans(plans)

  return (
    <section
      data-testid="tariff-comparison-card"
      aria-label="Сравнение тарифов"
      style={containerStyle}
    >
      <h2 style={headingStyle}>Тарифы</h2>
      <p style={subheadingStyle}>
        Сейчас вы на тарифе{' '}
        <strong style={{ color: 'var(--text)' }}>
          {ordered.find((p) => p.slug === currentPlanSlug)?.titleRu
            ?? currentPlanSlug}
        </strong>
        . Сменить тариф пока нельзя — публичный переход на платные планы
        активируется в одном из ближайших обновлений.
      </p>
      <div style={gridStyle}>
        {ordered.map((plan) => {
          const isCurrent = plan.slug === currentPlanSlug
          return (
            <PlanCard
              key={plan.slug}
              plan={plan}
              isCurrent={isCurrent}
            />
          )
        })}
      </div>
    </section>
  )
}

function PlanCard({
  plan,
  isCurrent,
}: {
  plan: TariffComparisonPlan
  isCurrent: boolean
}) {
  const features = formatFeatureLines(plan.features)
  return (
    <article
      data-testid={`tariff-card-${plan.slug}`}
      data-current={isCurrent ? 'true' : 'false'}
      style={{
        ...cardStyle,
        borderColor: isCurrent ? 'var(--accent)' : 'var(--border)',
        boxShadow: isCurrent ? '0 0 0 1px var(--accent)' : 'none',
      }}
    >
      {isCurrent ? (
        <div
          data-testid={`tariff-card-${plan.slug}-current-badge`}
          style={badgeStyle}
        >
          ● Текущий тариф
        </div>
      ) : null}
      <h3 style={titleStyle}>{plan.titleRu}</h3>
      <div style={priceStyle}>{formatPrice(plan.priceKopecksMonthly)}</div>
      <div style={learnerLimitStyle}>
        {formatLearnerLimit(plan.learnerLimit)}
      </div>
      {features.length > 0 ? (
        <ul style={featureListStyle}>
          {features.map((line) => (
            <li key={line} style={featureLineStyle}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        data-testid={`tariff-card-${plan.slug}-switch-button`}
        disabled
        title="Скоро / Свяжитесь с оператором"
        style={buttonStyle}
      >
        Сменить тариф
      </button>
    </article>
  )
}

const containerStyle: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 24,
  marginBottom: 24,
}

const headingStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  marginBottom: 8,
}

const subheadingStyle: CSSProperties = {
  color: 'var(--secondary)',
  fontSize: 13,
  lineHeight: 1.6,
  marginBottom: 20,
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 16,
}

const cardStyle: CSSProperties = {
  position: 'relative',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '20px 18px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const badgeStyle: CSSProperties = {
  alignSelf: 'flex-start',
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  marginBottom: 4,
}

const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  margin: 0,
}

const priceStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--text)',
  fontWeight: 500,
}

const learnerLimitStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--secondary)',
}

const featureListStyle: CSSProperties = {
  margin: '4px 0 0',
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const featureLineStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--secondary)',
}

const buttonStyle: CSSProperties = {
  marginTop: 'auto',
  padding: '8px 12px',
  background: 'transparent',
  color: 'var(--secondary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'not-allowed',
  opacity: 0.6,
}
