// Shared default timezone + safe-resolve helper.
//
// До этого `const TZ_DEFAULT = 'Europe/Moscow'` + `safeTz()` дублировались в
// 5 файлах под `app/cabinet/*`. Дубликаты несли риск drift'а (один файл
// возвращал бы дефолт, другой — undefined) и затрудняли изменение default'а.
//
// Этот модуль — single source of truth. Любой код, который форматирует
// даты с timezone из user profile (`account_profiles.timezone`), должен
// импортировать `TZ_DEFAULT` и `safeTz` отсюда.

export const TZ_DEFAULT = 'Europe/Moscow'

/**
 * Возвращает корректный IANA-id timezone, либо `TZ_DEFAULT` если входная
 * строка отсутствует или Intl.DateTimeFormat её не понимает (например,
 * пользователь хранит в БД устаревший alias).
 */
export function safeTz(tz: string | null | undefined): string {
  const candidate = tz ?? TZ_DEFAULT
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: candidate })
    return candidate
  } catch {
    return TZ_DEFAULT
  }
}
