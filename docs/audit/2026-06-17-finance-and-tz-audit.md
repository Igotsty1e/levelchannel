# Финансовая карточка + Дата/Время/Таймзоны — Audit

Дата: 2026-06-17 · Owner-feedback (5 задач в одном запросе)

---

## Часть A: TeacherFinanceSummary — проверка сходимости данных

### Что показывает карточка (4 метрики)

| Метрика | Источник | Период | TZ |
|---|---|---|---|
| **Заработано в ИЮНЕ** | `payment_claims` confirmed, sum(amount_kopecks) | месяц | UTC |
| **Должны прямо сейчас** | `listLearnersWithUnpaidSlots` — unpaid completions + overdue bookings | now | — |
| **Предоплата у учеников** | `package_purchases` × pro-rata remaining | now | — |
| **Ожидается на этой неделе** | `getTeacherCalendarSummary` — sum(snapshot) booked | week Mon-Sun | **teacher_tz** |

### Найденные расхождения

**BUG-F1 (ВЫСОКИЙ, исправлен в этом PR):** «Заработано» по UTC на `/teacher`, по local-server-tz на `/teacher/payments`. Окно расхождения — до 24 часов вокруг границы месяца, когда UTC и local-tz месяц отличаются.

Фикс: `app/teacher/payments/page.tsx` теперь использует `Date.UTC(...)` как `lib/billing/teacher-finance.ts:182`.

**BUG-F2 (СРЕДНИЙ, deferred):** «Должны прямо сейчас» включает overdue (start_at <= now), но не различает «занятие 5 минут назад» от «занятие месяц назад». Есть отдельная метрика `oldestDaysOverdue`, но в UI она не отображается. Owner — решите нужен ли визуальный split.

**BUG-F3 (LOW, deferred):** «Ожидается на этой неделе» использует `snapshot_amount_kopecks` — цену тарифа на момент бронирования. Если учитель изменит тариф, сумма НЕ обновится (snapshot заморожен). Это by design, но стоит документировать.

### Не баги, но inconsistency

| Метрика | UTC | teacher_tz |
|---|---|---|
| Заработано | ✓ | — |
| Должны | теперь | — |
| Предоплата | — | — (не зависит от tz) |
| Ожидается | — | ✓ |

«Заработано» и «Ожидается» используют разные tz: первая — UTC, вторая — teacher_tz. На стыке месяцев это может выглядеть «учитель видит май уже закончился по `Заработано`, но `Ожидается` ещё считает май». Рекомендация: переписать `Заработано` на teacher_tz для консистентности с `Ожидается` (отдельный PR).

---

## Часть B: Дата/Время/Таймзоны — полный аудит

Внешний audit-agent проверил весь codebase. Резюме найденного.

### Критические баги

**TZ-1 (КРИТИЧНО):** `toLocaleTimeString('ru-RU', ...)` без `timeZone` параметра в client-компонентах. На проде сервер NodeJS не в МСК → видны смещённые времена.

Файлы:
- `components/teacher/profile/profile-card.tsx:135`
- `components/teacher/digest-settings/bind-code-modal.tsx:43-46`
- `app/cabinet/profile-editor.tsx:80`
- `app/teacher/learners/[id]/rename-form.tsx:84`

**TZ-2 (КРИТИЧНО):** То же в server-side рендерах. Время бронирования / занятий показывается в tz сервера, а не tz пользователя.

Файлы:
- `app/cabinet/book/[ymd]/[slotId]/page.tsx:78`
- `app/cabinet/book/[ymd]/time-list.tsx:24`
- `app/teacher/learners/[id]/page.tsx:261`
- `app/teacher/learners/[id]/settle/page.tsx:172`

**TZ-3 (КРИТИЧНО):** «30 дней назад» как `Date.now() - 30*24*60*60*1000` — UTC ms, без учёта tz. На границе месяца ученик/учитель может видеть 29 или 31 день истории.

Файлы:
- `app/teacher/lessons/page.tsx:71`
- `app/cabinet/lessons/page.tsx:29`

### Не критичные, но стоит починить

**TZ-4 (СРЕДНИЙ):** `new Date().toISOString().slice(0, 10)` — UTC дата. На сервере вне UTC «сегодня» может оказаться завтра/вчера в браузере пользователя. Использовать `Intl.DateTimeFormat('sv-SE', { timeZone: userTz })` вместо.

**TZ-5 (LOW):** Inconsistency формата (`«7 июня»` vs `«07.06.2026»` vs `«07/06/2026»`) на разных surface-ах.

### Рекомендуемые helper'ы (отдельный PR)

```ts
// lib/util/format-date.ts (новый)

import { safeTimezone } from '@/lib/auth/timezones'

const DEFAULT_TZ = 'Europe/Moscow'

export function formatDateTimeInTz(
  iso: string,
  tz: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: safeTimezone(tz ?? DEFAULT_TZ),
    dateStyle: 'medium',
    timeStyle: 'short',
    ...opts,
  })
}

export function getTodayYmdInTz(tz: string | null | undefined): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: safeTimezone(tz ?? DEFAULT_TZ),
  }).format(new Date())
}
```

Затем — find-replace всех `.toLocaleString('ru-RU')` / `.toLocaleTimeString` / `.toISOString().slice(0,10)` на эти helper'ы. Это substantial PR.

### Postgres-сторона — уже OK

Postgres-запросы корректно используют `AT TIME ZONE $tz` (lib/notifications/teacher-digest-preview.ts, lib/calendar/summary.ts). Только JS-side рендер проблемный.

---

## Что в этом PR

1. **Один фикс:** UTC-границы месяца в `app/teacher/payments/page.tsx` (BUG-F1).
2. **Этот audit doc:** для трекинга остальных задач.

## Что НЕ в этом PR (backlog)

- TZ-1, TZ-2, TZ-3 — целая волна фиксов через новые helper'ы.
- BUG-F2, BUG-F3 — нужно бизнес-решение.
- «Заработано» переход на teacher_tz — отдельный PR.
