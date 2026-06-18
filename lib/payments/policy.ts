// 2026-06-18 codex-audit §5.2 fix — единственный источник правды для
// payment policy констант. До этого `PAYMENT_RETRO_WINDOW_*` дублировались
// в lib/payments/sbp-claims.ts и app/cabinet/lessons-section.tsx; оба
// места комментариями признавали что «должно совпадать» — leaky
// abstraction; следующий change inevitably сломал бы one side first.

// Окно «оплаты задним числом» — учник не может создать заявку на
// занятие старше N дней. Защищает учителя от late-claim'ов.
export const PAYMENT_RETRO_WINDOW_DAYS = 30

export const PAYMENT_RETRO_WINDOW_MS =
  PAYMENT_RETRO_WINDOW_DAYS * 24 * 60 * 60 * 1000

/**
 * True if startAtIso в пределах окна «можно оплатить» (т.е. слот
 * younger than RETRO_WINDOW). Использовать одновременно в server-side
 * (createLearnerClaim) и UI (CTA «Оплатить»).
 */
export function isWithinPaymentRetroWindow(startAtIso: string): boolean {
  const startAtMs = new Date(startAtIso).getTime()
  if (!Number.isFinite(startAtMs)) return false
  return startAtMs >= Date.now() - PAYMENT_RETRO_WINDOW_MS
}

/** True if startAtIso ВНЕ окна (старее cutoff) — keep server semantic. */
export function isSlotPastRetroWindow(startAtIso: string): boolean {
  return !isWithinPaymentRetroWindow(startAtIso)
}
