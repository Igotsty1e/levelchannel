// Time-of-day greeting in ru-RU, computed in the user's timezone.
// Used by /teacher (TeacherHomePage) and /cabinet (learner CabinetPage)
// so both surfaces share one source of truth.
//
// Boundaries match common Russian usage:
//   05:00–11:59 → «Доброе утро»
//   12:00–17:59 → «Добрый день»
//   18:00–22:59 → «Добрый вечер»
//   23:00–04:59 → «Доброй ночи»
//
// Falls back to «Здравствуйте» if the tz/Intl call throws (defensive).

export function greetingForHour(date: Date, tz: string): string {
  try {
    const hour = Number(
      new Intl.DateTimeFormat('ru-RU', {
        timeZone: tz,
        hour: '2-digit',
        hour12: false,
      }).format(date),
    )
    if (hour >= 5 && hour < 12) return 'Доброе утро'
    if (hour >= 12 && hour < 18) return 'Добрый день'
    if (hour >= 18 && hour < 23) return 'Добрый вечер'
    return 'Доброй ночи'
  } catch {
    return 'Здравствуйте'
  }
}
