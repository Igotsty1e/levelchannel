# Финансы на главной странице учителя

**Status**: round 1 — pre-implementation self-review
**Owner**: @ivankhanaev
**Author**: Claude (sonnet/opus)
**Codex-Paranoia**: SELF-REVIEW round 2/2 (Codex quota exhausted до 2026-06-11)

---

## 1. Цель

Дать учителю **at-a-glance**-сводку по деньгам прямо на `/teacher` (Главная) без дублирования того, что уже есть в `/teacher/payments`.

**Принцип разделения** (синтез из исследования джоб):
- **Главная** отвечает на «Я в порядке прямо сейчас? Где действовать сегодня?» — числа + alerts + CTA.
- **`/teacher/payments`** отвечает на «Что произошло и могу ли я это доказать?» — журнал, фильтры, экспорт.

## 2. Что уже есть (карта, не дублировать)

Source: research-agent + grep кодовой базы.

### 2.1. Главная `/teacher/page.tsx` (после refit 2026-06-07)
Сейчас показывает:
- `DigestPreviewTile` — сегодня уроков
- Следующие 3 booked-slot'а
- `TeacherSetupChecklist`
- **Никаких финансовых чисел нет**.

### 2.2. `/teacher/payments`
Уже на месте — журнал claims с агрегатами:
- `confirmedThisMonth` сумма за месяц (kopecks)
- `pendingSum` — кларимы в статусе claimed
- `unpaidLearners[]` — список с непогашенным
- `listExpiringPackagesForTeacher()` — пакеты, истекающие ≤14 дней или ≤2 урока
- Лента: claimed/confirmed/declined/cancelled

### 2.3. Calendar widget `<CalendarSummary>` (`/teacher/calendar`)
`weekEarningsKopecks` — сумма tariff-snapshot'ов по **booked** слотам недели. **Bookings, не payments** — деньги пока не пришли.

### 2.4. Lib-примитивы (готово к переиспользованию)
- `listLearnersWithUnpaidSlots(teacherId)` → `[{learnerId, learnerName, unpaidCount, unpaidAmount}]`
- `listClaimsForTeacher(teacherId, statusFilter[], limit)`
- `getTeacherCalendarSummary(teacherId, fromYmd)`
- `listExpiringPackagesForTeacher(teacherId)`

**Чего НЕТ как helper'а** (нужно написать):
- monthly earnings (paid this month, kopecks)
- previous-month earnings (для дельты)
- active prepaid sum (сумма остатков по неистраченным пакетам)
- next-7-days expected income (calendar × tariff)

### 2.5. Schema (что в БД)
- `lesson_completions` — paid lessons with `amount_kopecks` + `immutable_at`
- `payment_claims` — SBP журнал, status ∈ {claimed/confirmed/declined/cancelled}
- `payment_claim_items` — line items по слотам/пакетам
- `lesson_settlement_completions` — coverage matching
- `package_purchases` — пакеты learner'а
- `lesson_slots.snapshot_amount_kopecks` — tariff price на момент booking

**Нет `learner_balances` таблицы** — баланс вычисляется SQL'ем при чтении.

## 3. Что показываем на главной (max 5 чисел, anti-pattern guard)

Из research §2 («at-a-glance bar»): ≤5 чисел, иначе Christmas-Tree effect.

Берём **4 числа + 1 alert**:

### Card 1. «Заработано в этом месяце»
- **Источник**: `payment_claims.status='confirmed'` AND `resolved_at >= month_start` → sum(`amount_kopecks`).
- **Подпись**: «… ₽ за {месяц}»
- **Дельта**: «+12% к прошлому месяцу» (если прошлый месяц > 0) или нейтрально.
- **Action**: tap → `/teacher/payments` (открывается на confirmed-tab).

### Card 2. «Должны прямо сейчас»
- **Источник**: `listLearnersWithUnpaidSlots()` → `sum(unpaidAmount)` + `count(distinct learner)`.
- **Подпись**: «… ₽ · N учеников»
- **Action**: tap → `/teacher/payments#unpaid` (или прямой переход на список).
- **Бэдж**: красный, если хоть один долг >7 дней.

### Card 3. «Активные пакеты у учеников»
- **Источник**: live `package_purchases` — sum остатков лессонов × snapshot price.
- **Подпись**: «… ₽ предоплаты лежит · N учеников с пакетами»
- **Бэдж**: жёлтый, если есть пакет с ≤2 уроками (из `listExpiringPackagesForTeacher`).
- **Action**: tap → `/teacher/packages` или `/teacher/learners?filter=has-package`.

### Card 4. «Ожидается на этой неделе»
- **Источник**: переиспользуем `getTeacherCalendarSummary().weekEarningsKopecks` — сумма tariff snapshot'ов по booked слотам.
- **Подпись**: «… ₽ от {N} занятий до воскресенья»
- **Подзаголовок**: «при условии, что ученики проведут и оплатят»
- **Action**: tap → `/teacher/calendar`.

### Alert (опц., рендерится только если значимый)
- Если есть пакет, истекающий в ≤14 дней OR ученики, у кого ≤2 урока в пакете — баннер «Пакеты заканчиваются: N — обновить?»
- Если непогашено >7 дней по одному ученику — «У {имя} долг {N} дней».

**Не показываем** (anti-patterns из research §6):
- Lifetime earnings
- График за 12 месяцев
- Per-student ranking
- Net-after-expenses (нет ввода расходов в системе)
- Налог-овер-head (NPD cap — отдельная фича, см. §6.5 ниже)

## 4. Что остаётся на `/teacher/payments` (без дублирования)

Главная даёт **числа + действие**. Payments даёт **доказательство и историю**.

Конкретно payments сохраняет:
- Лента claims (фильтр по статусу)
- Полный список unpaid-learners с per-learner breakdown
- Список expiring packages (детально, с СТА «продать новый»)
- (новое) кнопка экспорта CSV по периоду
- (новое) фильтр по диапазону дат
- (новое) per-learner roll-up (lifetime paid, average lesson cost)

Эти расширения — **отдельная следующая итерация**, не в этом PR.

## 5. Тех-дизайн

### 5.1. Новый файл `lib/billing/teacher-finance.ts`

Чистая read-only функция:
```ts
export async function getTeacherFinanceSnapshot(
  teacherAccountId: string,
): Promise<TeacherFinanceSnapshot>
```

Возвращает:
```ts
type TeacherFinanceSnapshot = {
  thisMonth: {
    confirmedKopecks: number
    claimsCount: number
    monthLabel: string  // «июнь 2026»
  }
  lastMonth: {
    confirmedKopecks: number
  }
  unpaid: {
    totalKopecks: number
    learnerCount: number
    oldestDaysOverdue: number  // 0 если нет
  }
  activePackages: {
    sumOfRemainingKopecks: number
    learnersWithPackages: number
    expiringSoonCount: number  // ≤14d OR ≤2 lessons left
  }
  expectedThisWeek: {
    kopecks: number
    bookedSlotsCount: number
  }
}
```

Реализация: 4 SQL-запроса (в параллель, `Promise.all`):
1. `month` aggregates — JOIN `payment_claims` filtered by `resolved_at`
2. `unpaid` — переиспользуем `listLearnersWithUnpaidSlots` + считаем `oldestDaysOverdue`
3. `packages` — `package_purchases` где `remaining > 0` × snapshot price
4. `expected this week` — переиспользуем `getTeacherCalendarSummary().weekEarningsKopecks`

### 5.2. `app/teacher/page.tsx` SSR

После `<TeacherSetupChecklist />` и **до** «Следующие слоты» вставить:
```tsx
<FinanceSummary snapshot={await getTeacherFinanceSnapshot(account.id)} />
```

Если все 4 числа = 0 (новый учитель) — скрываем секцию целиком + показываем чек-листовую подсказку «настройте тариф / примите первый платёж».

### 5.3. Новый компонент `components/teacher/home/finance-summary.tsx`

Server component (не клиентский) — отдаёт 4 карты в grid:
- Desktop: `grid-template-columns: repeat(2, 1fr)` или `repeat(4, 1fr)` по ширине
- Mobile: 1 столбец, sticky-friendly высота

Карточный стиль = `var(--card)` + `border` + 12px радиус. Без анимации. Pure SSR — данные тянутся на каждый запрос.

CTA-ссылки — `<Link>`, не дублируют табы кабинета.

### 5.4. Analytics events (registry)

```ts
finance_card_clicked: z.object({
  card: z.enum(['this_month', 'unpaid', 'packages', 'expected']),
}),
```

## 6. Открытые вопросы к владельцу (max 5)

### Q1. «Заработано в этом месяце» — что считаем источником истины?
- (a) `payment_claims.confirmed` (вариант плана) — то, что я официально подтвердил как полученный платёж.
- (b) `lesson_completions.amount_kopecks` за immutable периоды — оплачено по факту оказанной услуги.
- Моё предложение: **(a)** — соответствует cash-in-hand для tutor'а; (b) включает в себя «отработано, но ещё не оплачено» что и есть Card 2.

### Q2. Делим ли заработок по способу оплаты (SBP / card / cash)?
- (a) Нет, одна цифра — проще.
- (b) Да, мини-сплит «… ₽ (SBP) + … ₽ (наличные) + … ₽ (карта)».
- Моё предложение: **(a)** для главной; полный split — на `/teacher/payments`.

### Q3. Alert по долгам — порог дней?
- (a) >7 дней по любому ученику → красный бэдж
- (b) >14 дней
- (c) >3 дней (для maximum motivation)
- Моё предложение: **(a) 7 дней** — стандарт freelance accounts receivable.

### Q4. НПД-cap warning (RU-specific) — включать сейчас?
Research §5 указал НПД 2.4M ₽/год как критичный сигнал.
- (a) Включаем сейчас как 5-й card: «X% годового лимита НПД».
- (b) Отдельная фича, после ввода налогового профиля учителя (есть ли он самозанятый, какой режим).
- Моё предложение: **(b)** — требует знания налогового статуса (которого нет в `accounts` сейчас) + не у всех учителей самозанятость. Делаем отдельно.

### Q5. «Ожидается на неделе» — учитывать probability (что ученик не отменит)?
- (a) Показываем сумму как есть.
- (b) Дисконт ×0.85 как «реалистичная оценка».
- Моё предложение: **(a)** — учителя сами знают свою отмен-rate; искусственное снижение confused.

## 7. Self-review (round 1)

### 7.1. Закрыто в этом проходе
- Карта существующего surface (§2) — проверена против codebase.
- Anti-pattern guard list (§3) — взят из research §6.
- Разделение «главная vs payments» — единая формула в §1.
- Lib-функция отдельным файлом — не лезет в существующий `lib/billing/*`.
- 4 SQL'я в параллель — не блокирующее.

### 7.2. Риски, которые я мог пропустить
1. **Performance**: 4 параллельных SQL запроса на каждом рендере главной = 4 коннекта/запрос. **Mitigation**: Postgres connection pool уже есть; запросы простые agg-only. Если станет узким — кэшим snapshot в memory на 60 сек.
2. **lesson_completions vs payment_claims rec drift**: research-agent заметил, что completions ≠ claims точно. **Action в impl**: явно прокомментировать в `getTeacherFinanceSnapshot` источник для Card 1 (Q1 ответ).
3. **`oldestDaysOverdue` SQL**: нужно знать дату когда долг возник — `lesson_slot.start_at` или `lesson_completion.completed_at`? **Confirm в impl**: лучше `completion.completed_at` — это когда услуга оказана и платёж ожидается.
4. **TZ-correctness для `monthLabel`**: использовать timezone учителя из `account_profiles.timezone`. **Action**: pass into snapshot fn.
5. **«Активные пакеты» при множественных тарифах**: пакет = N уроков × снапшот цены. Если разные тарифы у пакетов — суммируем. ✓
6. **Edge: впервые залогинившийся учитель** — все 0. Не показывать секцию вообще (§5.2). ✓
7. **A11y**: 4 карты должны быть `<a>` с descriptive label; не div'ы с onClick. ✓
8. **i18n**: Все строки на ru. ✓
9. **Анти-anxiety**: цифры обновляются на каждой загрузке страницы (не каждую минуту). ✓ (research §6 anti-pattern о per-minute refresh).
10. **Месячный rollover**: 1 числа каждого месяца Card 1 обнуляется. Учителя могут паниковать — добавить подпись «с 1 {месяц}» чтобы было понятно почему сброс.

### 7.3. Какой тест-план
Manual local:
1. Главная как новый teacher (нет данных) → секция скрыта.
2. Главная после 3 confirmed-payments → Card 1 показывает сумму + monthLabel.
3. Долги добавлены → Card 2 показывает X учеников и сумму.
4. Пакет с 2 уроками остатком → Card 3 показывает жёлтый бэдж.
5. Booked slots на текущей неделе → Card 4 показывает ожидание.

Integration test (`tests/integration/teacher/finance-snapshot.test.ts`) — sub-PR follow-up, не блокирует.

## 8. Декомпозиция

**Sub-PR A** — одним PR'ом:
- `lib/billing/teacher-finance.ts` + 4 SQL.
- `components/teacher/home/finance-summary.tsx`.
- `app/teacher/page.tsx` — вставка компонента.
- `lib/analytics/registry.ts` — 1 новое событие `finance_card_clicked`.
- ≤300 строк diff.

**Sub-PR B (отдельно после feedback)** — расширения `/teacher/payments`:
- CSV-экспорт
- Фильтр по диапазону
- Per-learner roll-up
- НПД-cap card (если Q4=да)

## 9. Готовность

Жду ответов на Q1-Q5. После «ОК» приступаю.
