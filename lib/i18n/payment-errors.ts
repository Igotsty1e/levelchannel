// 2026-06-12 payments-copy-and-states: централизованный маппинг
// серверных error-кодов на русские пользовательские тексты для всего
// раздела оплат + booking/cancel flows на стороне ученика. Раньше
// каждый компонент имел свой неполный словарь и сырые коды
// (already_paid, not_your_slot, slot_not_open, too_late_to_cancel
// и т.п.) утекали в UI как «Не удалось загрузить реквизиты: already_paid»
// или «HTTP 409».
//
// При появлении нового error-кода на сервере — добавлять сюда сразу,
// перед merge в main. Audit: grep `data?.error` + `data?.message` в
// клиентских компонентах должен быть пустым в плане сырых выводов.

const LEARNER_ERROR_MAP: Record<string, string> = {
  // pay-lesson-modal load (/api/learner/payment-context/[slotId])
  already_paid: 'За это занятие уже оформлена оплата.',
  not_your_slot: 'Это занятие не из вашего расписания.',
  slot_not_found: 'Занятие не найдено.',

  // pay-lesson-modal submit (/api/learner/payment-claims)
  slot_has_active_claim: 'По этому занятию уже есть незакрытая заявка.',
  // 2026-06-17 audit BUG C: окно ретро-оплаты (30 дней).
  slot_too_old: 'Это занятие старше 30 дней — оплату оформляет учитель вручную, напишите ему.',
  slot_already_paid: 'За это занятие уже оформлена оплата.',
  slot_not_belongs_to_pair: 'Это занятие не из вашего расписания.',
  method_archived: 'Реквизиты учителя сменились — обновите страницу.',
  method_not_found: 'Реквизиты учителя сменились — обновите страницу.',
  // 2026-06-17 prod-fix: до этого фикса клиент не слал id метода — на
  // прод-боксе сразу 400 на «Я оплатил(а)». Текст оставлен на случай
  // регрессии (метод исчез до сабмита) — обычно учнику делать ничего
  // не нужно, кроме перезагрузки.
  method_required_for_sbp: 'Не получилось определить реквизиты учителя — обновите страницу.',
  email_not_verified: 'Подтвердите e-mail, чтобы продолжить.',
  learner_archived: 'Ваш аккаунт деактивирован — напишите учителю.',
  amount_mismatch: 'Сумма не совпадает с тарифом — обновите страницу.',
  teacher_disabled: 'Учитель временно недоступен — попробуйте позже.',
  teacher_required: 'Не удалось определить учителя — обновите страницу.',
  rate_limited: 'Слишком много заявок подряд. Подождите минуту.',
  // Валидация payload (frontend-side guard'ы должны блокировать раньше,
  // но на всякий случай — friendly копи).
  invalid_amount: 'Некорректная сумма. Обновите страницу и попробуйте снова.',
  amount_too_large: 'Сумма слишком большая. Свяжитесь с учителем.',
  no_items: 'Не удалось определить занятие. Обновите страницу.',
  too_many_items: 'Слишком много занятий в одной заявке.',
  item_xor_violation: 'Не удалось оформить заявку. Обновите страницу.',
  package_not_found: 'Пакет не найден. Обновите страницу.',
  package_not_belongs_to_pair: 'Этот пакет не у вашего учителя. Обновите страницу.',

  // booking (/api/slots/[id]/book)
  slot_not_open: 'Это время уже занято.',
  past_slot: 'Это время уже прошло.',
  already_booked_by_other: 'Это время уже занято другим учеником.',
  teacher_unavailable: 'Учитель временно недоступен — попробуйте позже.',
  payment_method_not_set: 'У учителя не настроены реквизиты для оплаты.',
  package_required: 'Для записи нужен активный пакет — купите пакет.',
  pending_package_grant: 'Подождите, учитель ещё не подтвердил ваш пакет.',
  no_assigned_teacher: 'Учитель не назначен — напишите оператору.',

  // cancel (/api/slots/[id]/cancel)
  too_late_to_cancel: 'Срок отмены истёк — напишите учителю напрямую.',
  not_booked: 'Это занятие не забронировано.',
  already_cancelled: 'Занятие уже отменено.',

  // reschedule (/api/learner/lessons/[id]/reschedule)
  invalid_new_time: 'Выбрали некорректное новое время.',
  reschedule_too_late: 'Слишком поздно переносить — напишите учителю.',
  conflict: 'Это время уже занято — выберите другое.',

  // common boundary errors
  forbidden: 'Доступ запрещён — войдите в кабинет заново.',
  unauthorized: 'Сессия истекла — войдите в кабинет заново.',
  network_error: 'Не удалось соединиться с сервером. Проверьте интернет.',
}

/**
 * Returns a localized message for a known server error code, or null
 * for unknown codes (caller falls back to a generic message).
 */
export function localizeLearnerError(code: unknown): string | null {
  if (typeof code !== 'string' || code.length === 0) return null
  return LEARNER_ERROR_MAP[code] ?? null
}

/** Backwards-compatible alias — pay-lesson-modal imports localizePayError. */
export const localizePayError = localizeLearnerError
