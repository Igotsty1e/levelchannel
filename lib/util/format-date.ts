// 2026-06-17 — единые TZ-aware форматтеры даты/времени.
//
// Owner-feedback audit 2026-06-17: «Нигде не должно быть косяков с
// датами и таймзонами». Раньше многие места делали
// `new Date(iso).toLocaleString('ru-RU')` без `timeZone` параметра —
// рендер шёл в TZ Node-процесса (на проде вне MSK).
//
// Использование:
//   formatDateTimeInTz(slot.startAt, teacherTz)  // «17 июн, 13:03»
//   formatTimeInTz(slot.startAt, teacherTz)      // «13:03»
//   formatDateInTz(slot.startAt, teacherTz)      // «17 июня»
//   getTodayYmdInTz(teacherTz)                   // «2026-06-17»
//
// Когда tz = null/undefined, fallback на DEFAULT_TZ (Europe/Moscow).

import { safeTimezone } from '@/lib/auth/timezones'

const DEFAULT_TZ = 'Europe/Moscow'

function resolveTz(tz: string | null | undefined): string {
  return safeTimezone(tz ?? DEFAULT_TZ)
}

/** «17 июн, 13:03» — короткая дата + время в указанной TZ. */
export function formatDateTimeInTz(
  iso: string,
  tz: string | null | undefined,
): string {
  try {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: resolveTz(tz),
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    return fmt.format(new Date(iso))
  } catch {
    return iso
  }
}

/** «13:03» — только HH:mm в указанной TZ. */
export function formatTimeInTz(
  iso: string,
  tz: string | null | undefined,
): string {
  try {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: resolveTz(tz),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    return fmt.format(new Date(iso))
  } catch {
    return iso.slice(11, 16)
  }
}

/** «17 июня» (текущий год) / «17 июня 2025» (если другой год). */
export function formatDateInTz(
  iso: string,
  tz: string | null | undefined,
): string {
  try {
    const d = new Date(iso)
    const resolvedTz = resolveTz(tz)
    const currentYearFmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: resolvedTz,
      year: 'numeric',
    })
    const sameYear =
      currentYearFmt.format(new Date()) === currentYearFmt.format(d)
    const fmt = new Intl.DateTimeFormat('ru-RU', {
      timeZone: resolvedTz,
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    })
    return fmt.format(d)
  } catch {
    return iso
  }
}

/** Возвращает «сегодня» в указанной TZ как «YYYY-MM-DD». */
export function getTodayYmdInTz(tz: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: resolveTz(tz),
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** Возвращает дату N календарных дней назад в указанной TZ как «YYYY-MM-DD». */
export function getYmdNDaysAgoInTz(
  daysAgo: number,
  tz: string | null | undefined,
): string {
  const past = new Date()
  past.setUTCDate(past.getUTCDate() - daysAgo)
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: resolveTz(tz),
    }).format(past)
  } catch {
    return past.toISOString().slice(0, 10)
  }
}
