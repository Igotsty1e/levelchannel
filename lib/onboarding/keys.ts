// ONBOARDING wave Sub-PR A foundation.
//
// Single source of truth для whitelisted onboarding-hint ключей. И клиент,
// и сервер импортируют отсюда; помогает поймать опечатку (typecheck) и
// не позволяет писать arbitrary ключи в `account_onboarding_state.
// dismissed_hints`.
//
// Добавление нового hint'а:
//   1. Дописать ключ в массив ниже (alphabetical group within section).
//   2. Обновить `docs/plans/onboarding-tooltips-spec-2026-05-31.md` §1.
//   3. Подключить в соответствующем компоненте через `useOnboardingHint`
//      (Sub-PR B/C scope).
// Миграция БД не требуется — JSONB-shape это позволяет.

export const ONBOARDING_HINT_KEYS = [
  // must-have teacher hints (Sub-PR B)
  'teacher_setup_checklist',
  'tariff_first_create_hint',
  'packages_vs_tariffs_explainer',
  'tz_hint',
  'first_learner_celebrated',
  'first_mark_completed_hint',
  // must-have learner hints (Sub-PR C)
  'learner_cabinet_tour',
  'learner_reminder_hint',
  'first_completed_celebrated',
  'postpaid_explained',
  // cross-cutting (Sub-PR B + C share)
  'pwa_install',
] as const

export type OnboardingHintKey = (typeof ONBOARDING_HINT_KEYS)[number]

const KEY_SET: ReadonlySet<string> = new Set(ONBOARDING_HINT_KEYS)

/**
 * Type guard для проверки что произвольная строка — валидный hint-ключ.
 * Используется на API surface (`/api/onboarding-state/*`) чтобы reject'ить
 * unknown ключи с 400 Bad Request.
 */
export function isOnboardingHintKey(value: string): value is OnboardingHintKey {
  return KEY_SET.has(value)
}
