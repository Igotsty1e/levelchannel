/**
 * Event registry — single source of truth for всех событий аналитики.
 *
 * See docs/analytics/events.md для каталога с описаниями.
 *
 * Каждое событие имеет:
 *   - name (snake_case, past tense для действий)
 *   - Zod schema для properties (PII-allowlist enforced)
 *
 * Server отклоняет unknown events (drop + Sentry warning, не 400).
 * Client TypeScript types гарантируют что `track(name, props)` строго типизирован.
 */

import { z } from 'zod'

// ─── Property primitives ────────────────────────────────────────────

const ZTier = z.enum(['free', 'basic', 'pro'])
const ZTierName = z.enum(['Стартовый', 'Базовый', 'Расширенный'])
const ZRole = z.enum(['teacher', 'learner', 'guest'])

// ─── Event registry — все события + их schemas ──────────────────────

export const EVENT_REGISTRY = {
  // Universal — fired автоматически TrackingProvider'ом на route change.
  // Path-allowlist enforced server-side (no /admin/*, /_next/*, /api/*).
  page_view: z.object({
    title: z.string().max(200).optional(),
  }),

  // ─── Landing-v3 (главная) ───
  hero_cta_clicked: z.object({
    cta: z.enum(['primary_start_free', 'secondary_see_pricing']),
  }),
  pricing_tier_clicked: z.object({
    tier: ZTier,
    tier_name: ZTierName,
  }),
  integrations_link_clicked: z.object({
    target: z.enum(['google_calendar', 'telegram', 'email', 'digest']),
  }),
  pullquote_visible: z.object({}),
  multiplatform_visible: z.object({}),
  security_link_clicked: z.object({}),
  footer_link_clicked: z.object({
    target: z.string().max(64),
  }),

  // ─── SEO learn pages ───
  seo_cta_clicked: z.object({
    page: z.string().max(64),
    cta: z.enum(['open_cabinet', 'see_pricing']),
  }),

  // ─── Auth ───
  signup_form_focused: z.object({
    field: z.enum(['email', 'password', 'role']),
  }),
  signup_submit_started: z.object({
    role: ZRole,
  }),
  signup_completed: z.object({
    role: ZRole,
  }),
  signup_failed: z.object({
    reason: z.string().max(64),
  }),
  login_form_focused: z.object({
    field: z.enum(['email', 'password']),
  }),
  login_submit_started: z.object({}),
  login_completed: z.object({}),
  login_failed: z.object({
    reason: z.string().max(64),
  }),

  // ─── Teacher subscription ───
  subscription_plan_clicked: z.object({
    tier: ZTier,
  }),
  payment_widget_opened: z.object({
    surface: z.enum(['teacher_subscription', 'cabinet_packages', 'pay']),
    tier: z.string().max(32).optional(),
    amount_rub: z.number().int().nonnegative().optional(),
  }),

  // ─── Cabinet learner packages ───
  package_clicked: z.object({
    package_id: z.string().max(64),
    amount_rub: z.number().int().nonnegative(),
  }),
  buy_clicked: z.object({
    package_id: z.string().max(64),
  }),

  // ─── /pay (Анастасия legacy) ───
  plan_selected: z.object({
    plan_id: z.string().max(64),
  }),
  pay_clicked: z.object({
    plan_id: z.string().max(64),
    amount_rub: z.number().int().nonnegative(),
  }),

  // ─── Anastasia landing ───
  anastasiia_cta_clicked: z.object({
    cta: z.enum(['record_lesson', 'see_pricing', 'see_offer']),
  }),

  // ─── UX events (scroll, focus, time) ───
  form_field_focused: z.object({
    form: z.string().max(32),
    field: z.string().max(32),
  }),
  form_submit_failed: z.object({
    form: z.string().max(32),
    error_code: z.string().max(64),
  }),
  scroll_depth: z.object({
    depth: z.enum(['25', '50', '75', '100']),
  }),
  time_on_page: z.object({
    seconds: z.number().int().nonnegative().max(86400),
  }),

  // ─── Promo codes (Sub-PR C) ───
  promo_code_form_focused: z.object({}),
  promo_code_redeem_attempted: z.object({
    code_prefix: z.string().max(8),
  }),
  promo_code_redeem_succeeded: z.object({
    code_prefix: z.string().max(8),
    granted_days: z.number().int().min(1).max(365),
  }),
  promo_code_redeem_failed: z.object({
    code_prefix: z.string().max(8),
    reason: z.string().max(64),
  }),
} as const

export type EventName = keyof typeof EVENT_REGISTRY
export type EventProperties<N extends EventName> = z.infer<(typeof EVENT_REGISTRY)[N]>

/** Список путей, на которых page_view НЕ генерируется (админка, статика, API). */
export const PAGE_VIEW_BLOCKLIST = [
  /^\/admin(?:\/|$)/,
  /^\/_next(?:\/|$)/,
  /^\/api(?:\/|$)/,
] as const

export function isPageViewAllowed(path: string): boolean {
  return !PAGE_VIEW_BLOCKLIST.some((re) => re.test(path))
}

/** Безопасная валидация event'a с registry. Возвращает null если unknown/invalid. */
export function validateEvent(
  name: string,
  properties: unknown,
): { ok: true; name: EventName; properties: Record<string, unknown> } | { ok: false; reason: string } {
  if (!(name in EVENT_REGISTRY)) {
    return { ok: false, reason: 'unknown_event' }
  }
  const schema = EVENT_REGISTRY[name as EventName]
  const result = schema.safeParse(properties ?? {})
  if (!result.success) {
    return { ok: false, reason: 'invalid_properties' }
  }
  return { ok: true, name: name as EventName, properties: result.data as Record<string, unknown> }
}
