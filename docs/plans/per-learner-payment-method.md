---
title: Per-learner payment method (teacher's choice)
status: ACTIVE — one-PR epic
date: 2026-06-01
owner: claude-orchestrator
codex_consult: 2026-06-01 (vote Option b over Option a)
---

# Per-learner payment method

После SaaS-pivot платформа не принимает деньги учеников. Метод оплаты («постоплата с долгом» vs «предоплата пакетами» vs «ничего не настроено») — выбор учителя по каждому ученику отдельно.

## Owner answers (2026-06-01)

- Q1 — Блокировать смену метода при открытом постоплата-долге.
- Q2 — В проде ТОЛЬКО тестовые данные. Старые `postpaid_allowed` row'ы и `postpaid_debt` table — wipe. Clean break.
- Q3 — `'none'` = booking заблокирован, ученик видит «учитель не выбрал способ оплаты».
- Q4 — Drop `accounts.postpaid_allowed` в той же миграции (clean cut).
- Q5 — Только учитель может менять prefs.
- Q6 — UI и в списке `/teacher/learners`, и в invite-flow.
- Q7 — Audit log в `auth_audit_events` (новый event_type `auth.billing.method_changed`).
- Q8 — Stale-read OK, no advisory lock.
- Q9 — Только per-learner toggle, без mass-toggle.
- Q10 — `'prepaid_packages'` + 0 активных пакетов → booking заблокирован, CTA на `/cabinet/packages`.

## Scope (single PR)

### Файлы

1. **`migrations/0101_learner_billing_preferences.sql`**:
   - `CREATE TABLE learner_billing_preferences (teacher_account_id uuid, learner_account_id uuid, payment_method text CHECK in ('postpaid','prepaid_packages','none'), updated_at timestamptz, updated_by_account_id uuid, PRIMARY KEY (teacher_account_id, learner_account_id))`.
   - Extend `auth_audit_events.event_type_check` на `'auth.billing.method_changed'`.
   - `ALTER TABLE accounts DROP COLUMN postpaid_allowed` (clean cut — test data only в проде).
   - Если есть `postpaid_debt` таблица c test data — `TRUNCATE` (TBD после grep).
   - `ALTER TABLE teacher_invites ADD COLUMN default_payment_method text DEFAULT 'none' CHECK (...)` — для invite-flow default.

2. **`lib/billing/learner-payment-method.ts`** — helper:
   - `getPaymentMethodForPair(teacherId, learnerId): Promise<'postpaid'|'prepaid_packages'|'none'>` — SELECT, default `'none'` если row отсутствует.
   - `setPaymentMethodForPair({ teacherId, learnerId, method, byAccountId }): Promise<void>` — UPSERT + audit row.
   - `assertNoOpenDebtBeforeSwitch(teacherId, learnerId, fromMethod, toMethod)` — гарантия Q1.

3. **`lib/scheduling/slots/booking.ts`** — заменить чтение `accounts.postpaid_allowed` на helper. Поведение:
   - `'postpaid'` → существующая логика (создаёт debt row).
   - `'prepaid_packages'` → потребляет пакет; если нет пакета → reject с error code `payment_method_packages_no_active_package`.
   - `'none'` → reject с error code `payment_method_not_set`.

4. **`app/api/teacher/learners/[id]/billing/route.ts`** — `PATCH { method }` endpoint. Auth = учитель этого ученика. Возвращает 409 если debt open + switch блокирован.

5. **`app/teacher/learners/client.tsx`** + **`app/teacher/learners/[id]/page.tsx`** — UI selector «Способ оплаты» на карточке ученика. Visible to teacher only.

6. **`components/teacher/teacher-invite-section.tsx`** — добавить selector default-метода при создании инвайта.

7. **Migration backfill** — НЕ нужен, test data wiped. Pre-existing pairs получат `'none'` → booking блокируется → учитель явно выбирает.

8. **Удалить устаревшие**:
   - `app/api/admin/accounts/[id]/postpaid/route.ts` — admin override устарел (Q5=a).
   - UI: `app/admin/(gated)/accounts/[id]/page.tsx` блок про postpaid.
   - `components/calendar/BookConfirmModal.tsx` — display postpaid status remove.
   - `app/cabinet/page.tsx` — postpaid indicator remove.
   - `tests/integration/billing/admin.test.ts` — postpaid admin tests remove/rewrite.
   - `tests/integration/billing/booking.test.ts` — booking tests переписать на новый contract.
   - `docs/plans/prepay-postpay-billing.md` — Status: SUPERSEDED-BY этим документом.

### Тесты

- `tests/integration/billing/per-learner-payment-method.test.ts`:
  - Booking → 'none' → 422 `payment_method_not_set`.
  - Booking → 'postpaid' → creates debt row.
  - Booking → 'prepaid_packages' + active package → consume.
  - Booking → 'prepaid_packages' + no package → 422 `payment_method_packages_no_active_package`.
  - PATCH endpoint → switches method + audit row.
  - PATCH 'postpaid' → 'prepaid_packages' с open debt → 409 `debt_open`.

### Out of scope (follow-up)

- Mass-toggle UI (Q9=b).
- Admin override API (Q5=a).
- Read-only learner view (Q5=a).
- Advisory lock (Q8=b).

## Audit event shape

```sql
event_type = 'auth.billing.method_changed'
account_id = teacher_account_id  -- кто менял
payload = jsonb_build_object(
  'learner_account_id', learner_account_id,
  'from_method', old_method,
  'to_method', new_method
)
```

## Codex paranoia

Round 1/3 после готового PR. Если REVISE — фиксим в том же PR. SIGN-OFF trailer в commit.
