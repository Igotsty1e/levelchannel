---
title: epic-b — bulk-assign + package picker + drop prepaid_packages
status: PLAN
date: 2026-06-11
scope: 3-sub-PR epic
owner: ivankhanaev
author: claude
context_clean: no live users — migration drops value cleanly
---

# epic-b (2026-06-11)

## 0. TL;DR

3 sub-PR закрывают user-ask по mix-billing + bulk-assign:

1. **B.1 — drop `prepaid_packages` payment_method enum value.** Сейчас `learner_billing_preferences.payment_method` имеет три значения: `'postpaid' | 'prepaid_packages' | 'none'`. Драпаем `'prepaid_packages'`. После migration ученик с пакетом + payment_method='postpaid' всегда получает mix: package consume first → postpaid fallback. UI cleanup (admin/teacher payment-method selectors).

2. **B.2 — package picker в AssignDirectModal.** Endpoint `GET /api/teacher/learners/[id]/billing-state?duration=60` возвращает active packages + postpaid availability. Modal: picker «из пакета X (5/10)» / «постоплата» (auto-pre-select наилучший). Backend `assignSlotDirect` принимает `billingChoice`.

3. **B.3 — bulk-assign модалка** (epic-close). UI похожий на BulkAddSlotsModal: ученик (Combobox) → recurrence (weekday × time × span) → тариф/пакет (с picker'ом billing) → preview → submit. Endpoint `POST /api/teacher/slots/bulk-assign-direct`.

## 1. Existing surface inventory

```
rg -l "payment_method|consumePackageUnit|learner_billing_preferences" lib app
```

Hits (relevant):
- `migrations/0101_per_pair_payment_method.sql` — CHECK constraint defines enum values.
- `lib/billing/learner-payment-method.ts` — getPaymentMethodForPair, type.
- `lib/scheduling/slots/booking.ts` (bookSlot pipeline) + `mutations-assign-direct.ts` + `mutations-reschedule.ts` — все 3 учитывают payment_method.
- UI: `app/admin/learners/[id]/page.tsx`, `app/teacher/learners/[id]/page.tsx`, `app/cabinet/lessons-section.tsx`, `components/admin/*`, `components/teacher/learners/*`.

## 2. Sub-PR декомпозиция

### B.1 — drop prepaid_packages

**Migration 0126:**
```sql
-- Convert existing rows.
update learner_billing_preferences
   set payment_method = 'postpaid'
 where payment_method = 'prepaid_packages';

-- Replace CHECK constraint.
alter table learner_billing_preferences
  drop constraint if exists learner_billing_preferences_payment_method_check;
alter table learner_billing_preferences
  add constraint learner_billing_preferences_payment_method_check
  check (payment_method in ('postpaid', 'none'));
```

**Backend:**
- `lib/billing/learner-payment-method.ts` — type union `'postpaid' | 'none'`. Drop 'prepaid_packages'.
- `lib/scheduling/slots/booking.ts` — drop branch `if (method === 'prepaid_packages')` в bookSlot. Если no package → postpaid path всегда.
- `mutations-assign-direct.ts` + `mutations-reschedule.ts` — same.
- `lib/scheduling/teacher-learners.ts` — `paymentMethod` type narrow.

**Frontend:**
- Admin / teacher payment-method selectors — drop «Только пакеты» option.
- `app/cabinet/lessons-section.tsx` — drop `package_required` UI surface (это уже теперь происходит как fallback, не error).

LOC: ~400.

### B.2 — package picker в AssignDirectModal

**Backend:**
- New endpoint `GET /api/teacher/learners/[id]/billing-state` — body `{ durationMinutes: number }`. Returns `{ packages: [{ id, titleSnapshot, countRemaining, expiresAt }], postpaidAvailable: boolean }`.
- `lib/scheduling/slots/mutations-assign-direct.ts` — добавить `billingChoice` optional input:
  ```ts
  billingChoice?:
    | { kind: 'package'; packagePurchaseId: string }
    | { kind: 'postpaid' }
  ```
  - Если `kind='package'` → consume from this specific package (force packageId).
  - Если `kind='postpaid'` → skip package consumption, go postpaid.
  - Если omitted → existing auto-prefer-package logic.
- `consumePackageUnit` уже принимает `packagePurchaseId` optional override (если нет — нужно добавить).

**Frontend:**
- `AssignDirectModal` — после выбора learner + duration, load billing state. Show:
  - Section «Списать с»: radio options — active packages + postpaid (если available).
  - Auto-select earliest-expires package; fallback postpaid; disable submit if none.
- Pass `billingChoice` в submit.

LOC: ~350.

### B.3 — bulk-assign модалка (epic-close)

**Backend:**
- `POST /api/teacher/slots/bulk-assign-direct` — body `{ learnerAccountId, tariffId, startsIso[], billingChoice }`. Internal loop over startsIso, calls assignSlotDirect each in same TX. Stop on first failure (transactional).

**Frontend:**
- `components/calendar/BulkAssignDirectModal.tsx` (NEW) — clone BulkAddSlotsModal pattern:
  - Learner Combobox.
  - Recurrence picker (weekday × time × span).
  - Tariff/package picker (single billing choice for whole batch).
  - Preview (list of startsIso with status).
  - Submit.
- Mount in teacher/calendar/client.tsx как 4-я опция в FAB/desktop.

LOC: ~600.

**Total epic B:** ~1350 LOC, 3 sub-PR.

## 3. Acceptance criteria

1. Migration 0126 переводит существующие `'prepaid_packages'` → `'postpaid'`.
2. После migration все ученики с активным пакетом + postpaid имеют mix.
3. AssignDirectModal: учитель видит список активных пакетов ученика + postpaid; выбирает источник billing.
4. Bulk-assign модалка создаёт N booked-slots одним submit с одной billing choice.

## 4. Risks (self-review fallback)

- **MEDIUM: Migration data loss.** Если у учителя был учени́к с 'prepaid_packages' который НЕ хотел postpaid — после migration теперь postpaid возможен. **Mitigation:** user сказал «делай хорошо, нет live users».
- **MEDIUM: package consumption race в bulk-assign.** N slots → N consume calls в одном TX. Race с concurrent learner booking. **Mitigation:** advisory_lock per learner — same key как single assign.
- **LOW: bulk recurrence генерация при пересечении existing slots.** Каждый assignSlotDirect catches 23505 → slot_collision. Bulk endpoint должен decide: stop-on-first или skip-collisions. **Decision:** stop-on-first (transactional).

## 5. Tests

- Migration test: convert rows.
- Integration: assign-direct with packageChoice.
- Integration: bulk-assign happy path + collision handling.

## 6. Trailers

- Skill-Used: codex-paranoia (plan SELF-REVIEW round 1/3 — codex quota exhausted)
- Sub-PR commits: SUB-WAVE self-reviewed (epic epic-b) + epic-close SIGN-OFF.

## 7. Out of scope

- New billing-method enum values.
- Per-slot manual «split package + postpaid» (out of scope MVP).
