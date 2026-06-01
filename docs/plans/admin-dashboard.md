---
title: Admin dashboard — основные метрики + динамика
status: SHIPPED 2026-06-01 (PR pending merge) — codex-paranoia wave-mode round 1 BLOCK with 3 BLOCKER + 5 WARN closed
date: 2026-06-01
owner: claude-orchestrator (CPO-level brief)
---

# Admin dashboard

Operator (Анастасия) открывает `/admin/dashboard`, за 5 секунд видит state платформы. Сверху — light/red statelight. Дальше — 8 number-карточек с delta и sparkline. Под ними — funnel + динамика пользователей.

## What actually shipped (vs. plan)

R1 wave-paranoia revealed real plan/code drift. The shipped version differs from the plan below in 4 places — list them up-front so future reads of the plan are not misled:

1. **Health benchmarks**: plan said *median of prior period*; ship uses **absolute floors + simple previous-period halving** (`ABSOLUTE_FLOORS={activeTeachers: 1, lessonsCompleted: 1}` + `current < previous/2` → warn). Simpler, deterministic, no rolling-median state to maintain.
2. **Drill-down URLs**: plan said cards link with `?status=X&since=PERIOD`; ship links only `?status=X` (the slots page accepts `status` as of this PR; `since` is a follow-up — see §Follow-ups).
3. **Nav label**: plan said "Дашборд" → `/admin/dashboard`; ship uses "Метрики" because existing `/admin` already owns "Сводка" per `docs/content-style.md §Дашборд → Сводка`.
4. **Funnel definition**: plan stages were filtered on different timestamps (created_at vs booked_at vs completion-row created_at) which could yield impossible >100% conversion. Ship uses a **cohort funnel** — all 4 stages count subsets of the same cohort (slots created in period), guaranteeing monotonic decrease.

## Follow-ups (out of scope for this PR, captured for next pass)

- **Period-scoped drill-down on `/admin/slots`**: accept `?since=1d|7d|30d|all` and filter by `created_at`/`booked_at` as appropriate. Currently slots page ignores `since`.
- **Indexes on hot columns**: `lesson_slots(created_at)`, `lesson_slots(booked_at)`, `lesson_slots(status, cancelled_at)`, `lesson_slots(status, marked_at)`, `lesson_completions(completed_at)`. Plan included these but no migration shipped. Seq-scans grow linearly with data; revisit when prod row count > ~50k slots.
- **`forgottenBookings` time-bound**: currently a full-table scan (`status='booked' AND start_at + duration < now()`). Bound to last 30 days once index above lands.
- **15 parallel queries vs pool max=10**: 5 queries queue. Acceptable for an operator-only F5 page; consider per-route pool override if a higher-traffic dashboard ships later.

## Goal

Один экран. Operator-owner раз в день понимает: жива ли платформа, растёт ли база, падает ли retention. Не нужно читать SQL.

## Layout

```
┌────────────────────────────────────────────────────┐
│  /admin/dashboard                                  │
│                                                    │
│  ┌─ ✅ Платформа в норме (или ⚠️ 2 below norm) ──┐│
│  │  health-score банер (см. §Health score)       ││
│  └────────────────────────────────────────────────┘│
│                                                    │
│  [period: 1d | 7d | 30d | all]   ⓘ rolling window │
│                                                    │
│  ┌─Активные учителя─┐ ┌─Активные ученики──┐       │
│  │ 12 (+2 vs prev)   │ │ 47 (+5 vs prev)    │       │
│  │ ▁▂▃▅▇▇▇          │ │ ▁▂▃▅▆▇█           │       │
│  └──────────────────┘ └────────────────────┘       │
│                                                    │
│  ┌─Слотов создано──┐ ┌─Слотов забронир.──┐        │
│  │ 142              │ │ 89 (63% fill)       │        │
│  └──────────────────┘ └────────────────────┘        │
│                                                    │
│  ┌─Занятий проведено┐ ┌─Отменено────────┐         │
│  │ 78               │ │ 12               │         │
│  └──────────────────┘ └──────────────────┘         │
│                                                    │
│  ┌─No-show учитель──┐ ┌─No-show ученик──┐         │
│  │ 2 (2.5% от 80)  │ │ 4 (4.8% от 82)  │         │
│  └──────────────────┘ └──────────────────┘         │
│                                                    │
│  ┌── Конверсия created → booked → completed ─┐    │
│  │    Funnel chart (Recharts FunnelChart)    │    │
│  │    142 → 89 (63%) → 78 (87% from booked)  │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ┌── Динамика пользователей ────────────────┐     │
│  │    AreaChart teachers + learners stacked │     │
│  └──────────────────────────────────────────┘     │
└────────────────────────────────────────────────────┘
```

## Period filter

URL: `?period=7d` (default). Allowlist: `1d` / `7d` / `30d` / `all`. Любое другое значение → fallback `7d`.

**Window semantics — rolling.** `7d` = «последние 168 часов от now()», не «с понедельника». Простое определение, нет confusion около полуночи.

**Boundary tuple per period:**
- `current_start = now() - period`
- `current_end = now()`
- `prev_start = now() - 2*period`
- `prev_end = now() - period`
- `bucket_size`:
  - `1d` → hourly buckets (24 bars в sparkline)
  - `7d` → daily (7 bars)
  - `30d` → daily (30 bars)
  - `all` → weekly (capped 26 weeks = 6 months display)

`all` скрывает delta (нет prev period для сравнения).

## Health score banner — what shipped

3 states, computed off the same `metrics` object the cards consume:

| State | Условие | Display |
|---|---|---|
| ✅ Норма | None of the rules below fires | Зелёный banner «Платформа в норме» |
| ⚠️ Внимание | At least one delta-rule fires (current < previous/2) AND no floor | Жёлтый banner «N метрик ниже нормы» + список names |
| 🚨 Алерт | Any **absolute floor** breached OR 3+ distinct metrics below | Красный banner |

**Absolute floors** (R3-CPO #O fix; simpler than the rolling median originally planned — keeps the rule deterministic):

```
ABSOLUTE_FLOORS = {
  activeTeachers: 1,    // < 1 active teacher in window = 🚨
  lessonsCompleted: 1,  // < 1 completed lesson in window = 🚨
}
```

**Delta rule** (current < previous/2, warn):
- Активные учителя
- Занятий проведено
- Слотов создано

**Dedupe** (R1-WARN#5 fix): if a metric trips both the floor and the delta rule the label appears once in `belowThreshold` and counts once toward the 3+-below escalation.

`period='all'` returns `previous=null` so delta rules become inert (no prior period exists); only absolute floors and the 3+-below rule fire.

## Metrics catalog (после fixes E + H + D)

| ID | Метрика | SQL (core) | Drill-down |
|---|---|---|---|
| M1 | Активные учителя | `SELECT count(DISTINCT teacher_id) FROM lesson_completions WHERE created_at >= $period_start` | `/admin/accounts?role=teacher&active_since=$period` |
| M2 | Активные ученики | `SELECT count(DISTINCT s.learner_account_id) FROM lesson_completions lc JOIN lesson_slots s ON s.id=lc.slot_id WHERE lc.created_at >= $period_start` | `/admin/accounts?role=student&active_since=$period` |
| M3 | Слотов создано | `SELECT count(*) FROM lesson_slots WHERE created_at >= $period_start` | `/admin/slots?created_since=$period` |
| M4 | Слотов забронировано | `SELECT count(*) FROM lesson_slots WHERE booked_at >= $period_start` | `/admin/slots?status=booked&since=$period` |
| M5 | Занятий проведено | `SELECT count(*) FROM lesson_completions WHERE was_no_show=false AND created_at >= $period_start` | `/admin/slots?status=completed&since=$period` |
| M6 | Отменено | `SELECT count(*) FROM lesson_slots WHERE status='cancelled' AND updated_at >= $period_start` | `/admin/slots?status=cancelled&since=$period` |
| M7 | No-show учитель (% от проведённых) | numerator `lesson_slots.status='no_show_teacher'`, denominator `M5 + M7 + M8` | `/admin/slots?status=no_show_teacher&since=$period` |
| M8 | No-show ученик (% от проведённых) | `lesson_completions.was_no_show=true`, denominator same | `/admin/slots?status=no_show_learner&since=$period` |

«Активный учитель» = `lesson_completions` с этим `teacher_id` в period — locked definition. Бизнес-truth: учитель который провёл занятие.

## SQL implementation

### Batch query per metric (fix F)

Для каждой метрики — ONE CTE-based query returning current + previous values:

```sql
WITH
  current_period AS (
    SELECT count(*) AS val FROM lesson_slots
     WHERE created_at >= $now - $period
       AND created_at < $now
  ),
  previous_period AS (
    SELECT count(*) AS val FROM lesson_slots
     WHERE created_at >= $now - 2*$period
       AND created_at < $now - $period
  )
SELECT
  (SELECT val FROM current_period) AS current,
  (SELECT val FROM previous_period) AS previous;
```

**Shipped query count**: 15 queries per page load (9 metric reads + 4 sparkline reads + 1 funnel + 1 users-dynamics), fired via `Promise.all`. Pool max=10 so 5 queue briefly; acceptable for an operator-only F5 page (documented in §Follow-ups). The earlier «11 queries» line was stale before sparkline split.

### Sparkline batch (fix G)

Single CTE for all 8 metrics' time-series, returning N rows × 8 columns:

```sql
WITH buckets AS (
  SELECT generate_series(
    $period_start,
    $now,
    $bucket_interval  -- '1 hour' for 1d, '1 day' for 7d/30d, '1 week' for all
  ) AS bucket_start
)
SELECT
  b.bucket_start,
  (SELECT count(*) FROM lesson_slots WHERE created_at >= b.bucket_start AND created_at < b.bucket_start + $bucket_interval) AS slots_created,
  ...
FROM buckets b
ORDER BY b.bucket_start;
```

Перформанс note — N=24 buckets × 8 sub-queries = 192 sub-selects per render. На холодном кэше может быть 500ms. ACCEPTABLE для admin SSR. Если станет slow → moved to materialized view (отдельный mig + cron refresh).

### Timezone (fix H)

Все date_trunc'и с `AT TIME ZONE 'Europe/Moscow'`:

```sql
date_trunc('day', created_at AT TIME ZONE 'Europe/Moscow')
```

Bucket boundaries тоже в MSK для consistency с operator'ом.

## Funnel chart — what shipped (cohort, 4 stages)

Recharts FunnelChart with **4 stages**, all counting subsets of the same **cohort** (`lesson_slots.created_at` in period) so the funnel is monotonic-decreasing by construction (R1-BLOCKER#3 fix):

1. Создано — cohort total
2. Забронировано — cohort AND `booked_at` IS NOT NULL
3. Прошло start_at — cohort AND booked AND `start_at + duration < now()`
4. Проведено — cohort AND booked AND EXISTS non-no-show `lesson_completions` row

Single SQL with `FILTER (WHERE …)` aggregates + one correlated EXISTS for the join-required final stage. The earlier 3-stage funnel mixed `created_at` / `booked_at` / completion-row `created_at` and could yield >100% conversion. The cohort approach answers the operator question literally: of the slots created in this window, how many ever got booked / passed / done.

## Tech stack

- **Recharts** ~50KB. `npm i recharts` — в этом PR.
- **SSR:** `app/admin/(gated)/dashboard/page.tsx`, `force-dynamic`, `runtime: 'nodejs'`.
- **Client wrapper (fix I):** все Recharts компоненты в `'use client'` child — passed data props from SSR parent. SSR parent читает SQL, child рендерит charts.
- **Period util (fix J):** `lib/admin/dashboard-period.ts` exports `parsePeriodOrDefault(raw: string): Period`.
- **Data layer:** `lib/admin/dashboard.ts` — Promise.all batch reader. 15 queries (9 metrics + 4 sparklines + funnel + users-dynamics).
- **Delta NaN guard (fix K):** helper `formatDelta(current, prev)` returns `'—'` if prev is null/0, else `'+N%'` / `'-N%'`.

## Drill-down routes (fix M)

Verify в этом же PR:

| URL | Источник | What shipped |
|---|---|---|
| `/admin/slots?status=cancelled` | `app/admin/(gated)/slots/page.tsx` | ✅ shipped — page accepts `?status=<x>` (allowlisted) |
| `/admin/slots?status=booked` | same | ✅ same |
| `/admin/slots?status=completed` | same | ✅ same |
| `/admin/slots?status=no_show_teacher` | same | ✅ same |
| `/admin/slots?status=no_show_learner` | same | ✅ same |
| `?since=<period>` time filter on `/admin/slots` | — | ⏳ follow-up (see §Follow-ups at top) |

## Schema needs (no migration shipped)

All queries from existing tables. **Indexes NOT shipped** — captured as follow-up in §Follow-ups at top of doc. Targeted indexes when prod data warrants:

```sql
CREATE INDEX IF NOT EXISTS lesson_slots_created_at_idx ON lesson_slots(created_at);
CREATE INDEX IF NOT EXISTS lesson_slots_booked_at_idx ON lesson_slots(booked_at) WHERE booked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS lesson_slots_status_cancelled_at_idx ON lesson_slots(status, cancelled_at);
CREATE INDEX IF NOT EXISTS lesson_slots_status_marked_at_idx ON lesson_slots(status, marked_at);
CREATE INDEX IF NOT EXISTS lesson_completions_completed_at_idx ON lesson_completions(completed_at);
```

Note: index targets reflect R1-WARN#4 fix (terminal-state timestamps) and R1-BLOCKER#2 fix (completed_at, not created_at).

## Tests (fix N)

`tests/admin/`:

1. `dashboard-period.test.ts` — period parse + boundary tuple correctness (✅ from plan v0).
2. `dashboard-metrics-m1-m8.test.ts` — integration test per metric (×8). Seeds DB → query → asserts current + previous + delta calculation.
3. `dashboard-health-score.test.ts` — banner state thresholds (✅/⚠️/🚨).
4. `dashboard-page-smoke.test.ts` — SSR renders 200 + содержит `<svg>` (chart canvas marker).

## Phasing

**Single PR.** ~11 files, ~3-4 hours.

Files:
1. `app/admin/(gated)/dashboard/page.tsx`
2. `app/admin/(gated)/dashboard/client.tsx` (chart wrappers)
3. `app/admin/(gated)/dashboard/period-tabs.tsx`
4. `app/admin/(gated)/dashboard/metric-card.tsx`
5. `app/admin/(gated)/dashboard/health-banner.tsx`
6. `app/admin/(gated)/dashboard/funnel-section.tsx`
7. `lib/admin/dashboard.ts` (queries)
8. `lib/admin/dashboard-period.ts` (period util)
9. `lib/admin/dashboard-types.ts`
10. `tests/admin/dashboard-*.test.ts` (×4)
11. `package.json` + lock (Recharts)
12. (optional) `migrations/0102_dashboard_indexes.sql`

Plus extend `/admin/slots` query params если drill-down не покрывает (small SQL/parsing).

---

## Self-review pass 3 — CPO eye (after 14 fixes)

### What got better

- Health banner закрывает Pass 1 #1 — operator теперь видит «WHERE TO LOOK» before reading numbers.
- No-show percentages закрывают #2 — interpretable.
- Funnel chart закрывает #3 — conversion thinking is right framing.
- Active-teacher definition locked = #4.

### What's still suspect on CPO level

1. **«Платформа в норме» через median может молчать когда платформа умирает.** Если каждую неделю completion count падает на 10%, median будет догонять и health всегда зелёный. **Fix:** добавить absolute floor — например «<5 активных учителей за неделю = 🚨 alert независимо от prev period». Critical metric минимум.

2. **No comparison vs target/goal.** Operator может смотреть «10 учителей сегодня» и не знать «это 100% target или 10% target». MVP без target нормально, но **Fix:** placeholder в health score config «target_active_teachers=N» которое можно настроить через `operator_settings` table.

3. **Funnel chart на 3 stages — слишком coarse.** Реально funnel: created → booked → started (slot.start_at прошёл) → completed. Если занятие забронировано и не проведено — это lost conversion, но funnel это не покажет. **Fix:** добавить 4-й stage «Запланировано прошло» = slots which past start_at AND not yet completed. Подсветит «10 slots забронированы и забыты».

### CPO verdict pass 3

Plan moved from «good first draft» к «implementable». Все 3 находки — добавить и можно делать.

---

## Self-review pass 4 — Eng eye (after 14 fixes)

### What got better

- SQL definitions concrete and citation-ready (lesson_completions, not auth_audit_events).
- CTE batching reduces query count to ~11.
- Recharts SSR/client split documented.
- Period boundaries deterministic (rolling, не calendar).
- Delta NaN guard explicit.

### What's still wrong

1. **N=192 sub-selects in sparkline batch (fix G).** Хвалил как «acceptable for SSR», но на холодном кэше это может стать 1000ms+. **Fix:** reformulate via single GROUP BY date_trunc query per metric, NOT correlated subquery per bucket. Each metric становится:
   ```sql
   SELECT
     date_trunc('day', created_at AT TIME ZONE 'Europe/Moscow') AS bucket,
     count(*) AS val
   FROM lesson_slots
   WHERE created_at >= $period_start
   GROUP BY bucket
   ORDER BY bucket;
   ```
   Plus `generate_series` LEFT JOIN для empty buckets. Single grouped query → 24-30 rows max.

2. **«Запланировано прошло» (CPO pass 3 #3) требует extra query.** Slot statuses сейчас не включают «past start_at but not completed». **Fix:** computed query:
   ```sql
   SELECT count(*) FROM lesson_slots
    WHERE status = 'booked'
      AND start_at + (duration_minutes || ' minutes')::interval < now()
   ```

3. **Auth: кто видит dashboard?** Plan не упоминает. **Fix:** existing `/admin/(gated)/` layout уже требует admin role — наследуется. Verified.

4. **Concurrent /admin/dashboard hit от 2 operator'ов** — каждый запускает 11 queries. Не race, но DB load. **Fix:** OK для MVP (1-2 admin'а total). Если scale up — добавить short cache.

5. **Recharts treeshake.** Recharts известно как big. Default import ~50KB gzipped, но full `recharts` package ~250KB raw. **Fix:** import только нужные `{LineChart, AreaChart, FunnelChart, ResponsiveContainer}` — modern bundler сам treeshake'нёт.

### Eng verdict pass 4

Plan ready for implementation. 5 small issues — 3 fixable inline в PR, 2 (Auth + scale) — accept as-is.

---

## Pass 3+4 patches — applied inline

**CPO:**
- (O) Absolute floor в health score: «critical metric < absolute threshold» = 🚨 даже если delta OK.
- (P) Target в health score config — placeholder в `operator_settings` (key `DASHBOARD_TARGET_ACTIVE_TEACHERS` etc), default null.
- (Q) Funnel расширен на 4 stages: Created → Booked → Запланировано прошло → Completed.

**Eng:**
- (R) Sparkline SQL переехал на GROUP BY date_trunc + generate_series JOIN, не correlated subquery.
- (S) M-extra: «slots запланированы и забыты» = past start_at + status='booked', добавлен как 9th metric M9.

## Final status

Plan-doc passed 4 self-review rounds (2 + 2 after fixes). Total 17 правок (14 + 3 в pass 3 + 5 в pass 4). Ready for implementation.

**Implementation est:** ~4-5 hours.

**Codex paranoia:** single-PR epic, один round on epic-end before merge.
