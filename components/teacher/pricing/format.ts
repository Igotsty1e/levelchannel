// Money + duration formatters shared between /teacher/tariffs and
// /teacher/packages. Russian rubles are integer in this product —
// `Intl.NumberFormat('ru-RU')` with 0 fraction digits gives «1 200 ₽»
// (NBSP-grouped, no trailing «.00»). Avoid `toFixed(2)` everywhere in
// pricing UI: admin paradigm, not the tutor's mental model.

const RUB_FORMATTER = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatRubles(amountKopecks: number): string {
  const rub = Math.round(amountKopecks / 100)
  return RUB_FORMATTER.format(rub)
}

export function formatDurationMinutes(minutes: number): string {
  // Short read-mode label: «60 мин». We never spell out «минут» / «минута»
  // on cards — saves horizontal real-estate at 360px and reads consistent.
  return `${minutes} мин`
}

export function formatLessonsCount(count: number): string {
  // «4 занятия», «8 занятий» — Russian numeric agreement for the UI
  // string «На N занятий». Falls into 5+ form for 11-19 + 5-19 + 25..29,
  // few-form for 2-4 etc.
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 19) return `${count} занятий`
  if (mod10 === 1) return `${count} занятие`
  if (mod10 >= 2 && mod10 <= 4) return `${count} занятия`
  return `${count} занятий`
}
