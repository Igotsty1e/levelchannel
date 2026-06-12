// 2026-06-12 payments-copy-and-states: маппинг серверных error-кодов на
// русский для учительских surface'ов (payments feed, refunds, policy,
// payment-methods editor, learners list rename/toggle). Раньше сырые
// коды утекали в UI как «HTTP 409» или «slot_has_active_claim».

const TEACHER_ERROR_MAP: Record<string, string> = {
  // payment-claims (confirm / decline)
  claim_not_found: 'Заявка не найдена.',
  claim_already_resolved: 'Эту заявку уже закрыли.',
  claim_not_yours: 'Эта заявка не из вашего расписания.',

  // payment-refunds
  refund_exceeds_claim: 'Сумма возврата больше, чем была оплачена.',
  claim_not_confirmed: 'Возврат можно сделать только по подтверждённой оплате.',
  refund_already_processed: 'Возврат по этой оплате уже оформлен.',

  // payment-methods CRUD
  phone_required: 'Укажите номер телефона.',
  bank_required: 'Укажите банк.',
  invalid_phone: 'Неверный формат — введите номер в виде +7 999 123-45-67.',
  invalid_bank: 'Название банка пустое или слишком длинное.',
  limit_reached: 'Достигнут лимит активных способов оплаты (10).',
  method_in_use: 'Этот способ ещё используется — нельзя удалить.',

  // policy editor
  invalid_payload: 'Не удалось сохранить — проверьте ввод.',

  // common boundary
  forbidden: 'Доступ запрещён.',
  unauthorized: 'Сессия истекла — войдите в кабинет заново.',
  rate_limited: 'Слишком много действий подряд. Подождите минуту.',
}

export function localizeTeacherError(code: unknown): string | null {
  if (typeof code !== 'string' || code.length === 0) return null
  return TEACHER_ERROR_MAP[code] ?? null
}
