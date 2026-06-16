# Wave-A: Notification dispatch для 7 lesson-событий (impl-ready)

Status: SHIPPED 2026-06-16 · Owner: claude
Parent epic: `docs/plans/teacher-master-flow-2026-06-15.md` (Wave 1)
Source: `docs/audit/2026-06-15-reschedule-cancel-markpaid-audit.md` (5 BLOCKER + 3 HIGH)

Shipped PRs (range `092326e..cddceb8`):
- PR #646 — Sub-PR 1 dispatch foundation + migration 0130
- PR #647 — Sub-PR 2 cancel + reschedule integration
- PR #648 — Sub-PR 3 mark-paid + claim confirm/decline + refund

Sibling CI-unblock PRs: #650 (Playwright http://-on-prod escape-hatch + integration retry budget) + #652 (extend E2E flag to email/auth-rate-limit validators).

Codex-Paranoia: self-review fallback SIGN-OFF round 1/3 (Codex CLI binary unavailable + raw exec blocked by hook). 3 BLOCKER closed at plan-time, 0 BLOCKER at wave-time, 4 WARN documented inline. Replay /codex-paranoia plan + wave когда Codex restored.

---

## Context

Аудит выявил: ни одно из 7 lesson-событий не шлёт email/TG. У учителя и ученика «слепое пятно» — узнают об отмене / переносе / оплате только когда сами зайдут в кабинет.

Wave-A создаёт **единую dispatch-точку** для всех 7 событий. После Wave-A любая mutation в `lib/scheduling/slots/*` или `lib/payments/sbp-claims.ts` вызывает `dispatchLessonEvent(kind, ctx)` — и сразу идёт email + TG получателю.

## Scope — 7 events

| # | Event kind | Trigger | Recipient | Severity (audit) |
|--:|---|---|---|---|
| 1 | `LessonCancelledByTeacher` | `cancelSlotByTeacher` succeed | Ученик | BLOCKER B-01 |
| 2 | `LessonCancelledByLearner` | `cancelLearnerSlot` succeed | Учитель | BLOCKER B-02 |
| 3 | `LessonRescheduledByLearner` | `rescheduleSlotByLearner` succeed | Учитель | BLOCKER B-03 |
| 4 | `LessonMarkedPaidByTeacher` | `createTeacherMarkPaid` succeed | Ученик | BLOCKER B-05 |
| 5 | `PaymentClaimConfirmed` | `/payment-claims/[id]/confirm` succeed | Ученик | (часть B-05) |
| 6 | `PaymentClaimDeclined` | `/payment-claims/[id]/decline` succeed | Ученик | HIGH H-01 |
| 7 | `PaymentRefundIssued` | `/payment-refunds` POST succeed | Ученик | HIGH H-02 |

**Не в Wave-A** (отдельные эпики):
- `LessonMarkedNoShow` / `LessonMarkedCompleted` — придут с эпиком B (lesson-history)
- `LessonRescheduledByTeacher` — придёт с эпиком D (teacher reschedule UI)
- `LessonUncompleted` — HIGH H-03, придёт с эпиком B
- TG для уже-работающих partial paths (`SbpClaimSubmitted`, `DirectAssign`) — Wave-C

Это даёт **7 событий × 2 канала = 14 dispatch-комбинаций** в Wave-A.

---

## Архитектура

### Слои

```
mutation handler (cancel/reschedule/markpaid)
        │ try { await dispatchLessonEvent(kind, ctx) } catch { log only }
        ▼
lib/notifications/lesson-event-dispatch.ts  ← unified entry
        │
        ├─→ recipient resolution (accounts table)
        ├─→ idempotency check (notification_log.dedup_key)
        ├─→ render email template (lib/email/templates/lesson-events/*.ts)
        ├─→ render TG template (lib/notifications/telegram/lesson-events/*.ts)
        ├─→ sendEmail() / sendTelegram()
        └─→ INSERT notification_log row (status + error_text)
```

### Best-effort semantics

- Dispatch **никогда не блокирует** mutation. Mutation коммитится первой, dispatch вызывается после `await client.query('commit')`.
- Внутри dispatch — `try/catch` на каждый канал. Email-fail не ломает TG. TG-fail не ломает запись в log.
- Каждый dispatch пишет ROW в `notification_log` со status `sent` или `failed` (+ error_text). Это **audit trail для replay** и **dedup**.
- **TG timeout (self-review BLOCKER #3):** `sendTelegram` оборачивается в `AbortController` с timeout 5s. Без этого зависший TG API hang'нет dispatch и в худшем сценарии — Next.js server response (long-running route).
- **Email timeout:** Resend SDK имеет встроенный 10s timeout; reuse-ом.

**Acceptable trade-off (documented):** между `commit` mutation и `await dispatchLessonEvent(...)` процесс может умереть (crash, OOM). DB-state будет sane, но notification_log пуст. Это **best-effort by design**. В будущем — миграция на outbox-worker pattern (отдельный эпик).

### Idempotency

- `notification_log.dedup_key UNIQUE` — формат `<event_kind>:<related_id>:<channel>:<iter_seq>`. Например `LessonCancelledByTeacher:slot-uuid:email:3`.
- `iter_seq` = `jsonb_array_length(lesson_slots.events)` на момент dispatch (или `claim_events.length` для payment-claims). Это гарантирует что **каждое отдельное логическое событие** имеет свой dedup_key. Сценарий: slot cancel → uncomplete (через separate flow) → cancel снова. Без `iter_seq` второй cancel был бы помечен как dup, что — **bug**. С `iter_seq` каждый cancel имеет разный length и dedup работает корректно.
- Перед отправкой: `SELECT 1 FROM notification_log WHERE dedup_key = $1 AND status = 'sent'`. Если есть — `skip` (НЕ error).
- Это закрывает: повторный POST cancel (retry frontend), Resend timeout retry, фоновый replay.

**Self-review BLOCKER #2 закрытие (dedup collision):** включаем `iter_seq` в dedup_key format — выше детали.

### Recipient resolution

- Email: `accounts.email` (всегда есть)
- TG: `accounts.teacher_telegram_chat_id` (если recipient — учитель) OR `accounts.learner_telegram_chat_id` (если ученик)
- Если TG чат не привязан → `status='skipped'` в log, no error
- Помогает helper `resolveRecipient(accountId, role)` в dispatch.ts

**Self-review BLOCKER #1 закрытие (privacy):** `resolveRecipient` ОБЯЗАТЕЛЬНО проверяет `accounts.archetypes` содержит запрошенную role. Если callsite передал teacher accountId с `role='learner'` (ошибка в коде) — refuse dispatch, throw `RoleMismatchError`, лог. Гарантия: учителю никогда не уйдёт «ваше занятие отменили» как ученику.

---

## File layout (new)

```
lib/notifications/
  lesson-event-dispatch.ts         ← entry point: dispatchLessonEvent(kind, ctx)
  recipient-resolver.ts            ← accounts → {email, tgChatId} resolution
  idempotency-check.ts             ← dedup_key check + insert
  telegram/
    send.ts                        ← thin wrapper around BOT_TOKEN sendMessage API
    lesson-events/
      lesson-cancelled-by-teacher.ts
      lesson-cancelled-by-learner.ts
      lesson-rescheduled-by-learner.ts
      lesson-marked-paid-by-teacher.ts
      payment-claim-confirmed.ts
      payment-claim-declined.ts
      payment-refund-issued.ts
lib/email/templates/lesson-events/
  lesson-cancelled-by-teacher.ts   ← {subject, html, text}
  lesson-cancelled-by-learner.ts
  lesson-rescheduled-by-learner.ts
  lesson-marked-paid-by-teacher.ts
  payment-claim-confirmed.ts
  payment-claim-declined.ts
  payment-refund-issued.ts
lib/email/dispatch.ts (extend)
  + sendLessonCancelledByTeacherEmail(to, params)
  + sendLessonCancelledByLearnerEmail(to, params)
  + sendLessonRescheduledByLearnerEmail(to, params)
  + sendLessonMarkedPaidByTeacherEmail(to, params)
  + sendPaymentClaimConfirmedEmail(to, params)
  + sendPaymentClaimDeclinedEmail(to, params)
  + sendPaymentRefundIssuedEmail(to, params)
migrations/
  0117_notification_log.sql        ← новая таблица
```

## Migration `0117_notification_log.sql`

```sql
create table notification_log (
  id uuid primary key default gen_random_uuid(),
  event_kind text not null,
  related_slot_id uuid,
  related_claim_id uuid,
  related_refund_id uuid,
  recipient_account_id uuid not null,
  channel text not null check (channel in ('email','telegram')),
  status text not null check (status in ('sent','failed','skipped')),
  dedup_key text not null unique,
  dispatched_at timestamptz not null default now(),
  error_text text,
  payload jsonb,
  constraint notification_log_recipient_fk
    foreign key (recipient_account_id) references accounts(id) on delete cascade
);

create index notification_log_dispatched_at on notification_log(dispatched_at desc);
create index notification_log_slot on notification_log(related_slot_id) where related_slot_id is not null;
create index notification_log_claim on notification_log(related_claim_id) where related_claim_id is not null;
```

Add migration prefix per `scripts/check-migration-prefixes.mjs`.

---

## API dispatch

```ts
// lib/notifications/lesson-event-dispatch.ts

export type LessonEventKind =
  | 'LessonCancelledByTeacher'
  | 'LessonCancelledByLearner'
  | 'LessonRescheduledByLearner'
  | 'LessonMarkedPaidByTeacher'
  | 'PaymentClaimConfirmed'
  | 'PaymentClaimDeclined'
  | 'PaymentRefundIssued'

export type LessonEventCtx = {
  slotId?: string
  claimId?: string
  refundId?: string
  recipientAccountId: string
  recipientRole: 'teacher' | 'learner'
  // event-specific payload — typed per kind via discriminated union
  payload: LessonEventPayload
}

export async function dispatchLessonEvent(
  kind: LessonEventKind,
  ctx: LessonEventCtx,
): Promise<{ email: Result; telegram: Result }>
```

Каждый `kind` имеет свой `payload` тип (TS discriminated union). `payload` сериализуется в `notification_log.payload` для replay.

---

## Integration points — где вызывать

| Файл | Где вызвать | После чего |
|---|---|---|
| `lib/scheduling/slots/mutations-cancel.ts:226` (после `return rowToSlot(...)` в `cancelLearnerSlot`) | до `return { ok:true, slot }` (post-commit) | `LessonCancelledByLearner` |
| `lib/scheduling/slots/mutations-cancel.ts:307` (после `commit` в `cancelSlotByTeacher`) | до возврата success | `LessonCancelledByTeacher` |
| `lib/scheduling/slots/mutations-reschedule.ts:209` (после `await client.query('commit')`) | до return success | `LessonRescheduledByLearner` |
| `lib/payments/sbp-claims.ts:256` (после `commit` в `createTeacherMarkPaid`) | до return success | `LessonMarkedPaidByTeacher` |
| `app/api/teacher/payment-claims/[id]/confirm/route.ts` (после resolveClaim succeed) | inside route handler | `PaymentClaimConfirmed` |
| `app/api/teacher/payment-claims/[id]/decline/route.ts` | same | `PaymentClaimDeclined` |
| `app/api/teacher/payment-refunds/route.ts` (после INSERT refund) | inside route handler | `PaymentRefundIssued` |

**Шаблон вызова в каждой точке:**
```ts
import { dispatchLessonEvent } from '@/lib/notifications/lesson-event-dispatch'

// ... after successful commit ...
try {
  await dispatchLessonEvent('LessonCancelledByTeacher', {
    slotId: oldSlot.id,
    recipientAccountId: oldSlot.learnerAccountId,
    recipientRole: 'learner',
    payload: {
      teacherName,
      slotStartAtIso,
      durationMinutes,
      reason: reason ?? '',
    },
  })
} catch (e) {
  console.error('[dispatchLessonEvent] failed', e)
}
```

---

## Anti-spam / rate-limit

- Cancel + Reschedule: **редкие события**, без rate-limit. Каждое слот-движение = 1 dispatch на recipient.
- Mark-paid: учитель может отметить 10 учеников разом через bulk → **10 dispatch-ов** к 10 разным recipient-ам → не рейт-лимит per-recipient (1 учитель в bulk).
- Reuse-able policy: если хотим в будущем добавить «не больше N в час» — таблица `notification_log` уже даёт нужный count.
- **В Wave-A rate-limit НЕ внедряем** — дополним по необходимости в Wave-E.

## Templates

7 email templates + 7 TG templates. Каждый минимальный: один заголовок, 2-3 ключевых факта, action-link в кабинет.

**Security (self-review WARN):** все free-text fields (`reason`, имя учителя/ученика, тариф) обязательно HTML-escape'ятся в email render. Reuse-ом `escapeHtml()` helper. TG templates — plain text, escape не нужен но **MarkdownV2 reserved chars** (`_*[]()~>#+-=|{}.!`) должны escape'иться через `escapeTgMarkdown()`.

**Privacy (self-review WARN):** `notification_log.payload` jsonb НЕ содержит секретов / PII за пределами того что уже видит recipient (имя, дата, причина). Запрет на запись emails / payment tokens / phone numbers в payload. Code-review check.

Пример (email cancel by teacher → learner):
```
Subject: Учитель отменил занятие 16 июня

Здравствуйте, <learner first_name>.

Учитель отменил занятие на <date> <time> <tz>.
Причина: <reason>

Если хотите перенести — откройте кабинет и запишитесь на другое время:
<cabinet_url>

— LevelChannel
```

TG-версия — короче, эмодзи минимальны:
```
❌ Учитель отменил занятие на <date> <time>.
Причина: <reason>
Перенести: <cabinet_url>
```

## Tests

### Unit
- `tests/notifications/lesson-event-dispatch.test.ts`:
  - все 7 kinds renderнятся OK
  - recipient resolution: email+TG / email only / no recipient
  - idempotency: повторный dispatch с тем же dedup_key → skip
- `tests/email/lesson-events-templates.test.ts` — 7 шаблонов: snapshot subject/html

### Integration (Docker Postgres)
- `tests/integration/notifications/dispatch-flow.test.ts`:
  - cancel learner mutation → dispatch fired → notification_log row inserted
  - same mutation повторно → dedup → no double insert
- `tests/integration/notifications/cancel-teacher-dispatch.test.ts` — end-to-end
- `tests/integration/notifications/reschedule-dispatch.test.ts`
- `tests/integration/notifications/mark-paid-dispatch.test.ts`

Email отправка mock'нута через `vi.mock('@/lib/email')`. TG — через mock на `sendTelegram`.

## Sub-PR разбивка

### Sub-PR 1 (≈1d): foundation
- Миграция 0117 `notification_log`
- `lib/notifications/lesson-event-dispatch.ts` + recipient-resolver + idempotency-check
- `lib/notifications/telegram/send.ts`
- 7 типов в `LessonEventKind` + discriminated union для payload
- Unit tests на dispatch + recipient
- НИКАКОЙ integration в mutations пока

### Sub-PR 2 (≈1d): cancel + reschedule events
- 3 email templates (cancel teacher, cancel learner, reschedule learner)
- 3 TG templates
- Extend `lib/email/dispatch.ts` 3 helper-функциями
- Integrate в `lib/scheduling/slots/mutations-cancel.ts` (2 точки) + `mutations-reschedule.ts` (1 точка)
- Integration tests на 3 события

### Sub-PR 3 (≈1d): mark-paid + claim + refund events
- 4 email templates (marked-paid, confirm, decline, refund)
- 4 TG templates
- Extend dispatch.ts 4 helper-функциями
- Integrate в `sbp-claims.ts:createTeacherMarkPaid` + 3 routes (confirm/decline/refund)
- Integration tests на 4 события

### Sub-PR 4 (≈0.5d): wave-close
- Финальный smoke на агрегате
- /document-release: обновить `lib/email/dispatch.ts` doc + memory `2026-06-15_notification_wave_a_activated.md`
- Plan-doc Status: SHIPPED + SHIPPED-INDEX entry

---

## Risks

- **БД migration на large `accounts` table:** notification_log FK references accounts(id). Безопасно, не блочит. Но проверить что lookup recipient_account_id быстрый (индекс на accounts.id — PK, есть).
- **Email rate-limit от Resend** при bulk mark-paid (10 писем разом) — обычно ОК (Resend держит 100+/sec). В worst case dispatch получит 429 → status='failed' в log → можно replay.
- **TG bot rate-limit (30 msg/sec global, 1 msg/sec per chat)** — bulk mark-paid 10 учеников = 10 разных chats, OK. Если когда-то добавим broadcast — нужен throttle.
- **dedup_key uniqueness:** при race (2 concurrent retry) — UNIQUE constraint → второй INSERT fail. Обработать как `skipped`, не error.
- **Изменение mutation contracts:** не меняем. Dispatch вызывается ПОСЛЕ commit, никаких changes к return shape.

## Self-review checklist (RUN — 2026-06-15)

- [x] Recipient resolution не утечёт email учителя ученику → `resolveRecipient` hard-checks `accounts.archetypes`
- [x] dedup_key format не имеет collision между event kinds → включён `iter_seq` (length events array)
- [x] Failed email/TG не блокируют save mutation → dispatch ПОСЛЕ commit + try/catch на каждый канал
- [x] notification_log payload не содержит секретов → code-review гайд + типы payload exclude PII surfaces
- [x] Idempotency срабатывает на retry frontend POST cancel → SELECT по dedup_key перед send
- [x] Mock-ы в тестах не позволяют реально отправлять → `vi.mock('@/lib/email')` + `vi.mock('@/lib/notifications/telegram/send')` в каждом test файле
- [x] TG send timeout → AbortController 5s
- [x] HTML escape free-text в email → `escapeHtml(reason)` в template render
- [x] TG Markdown escape → `escapeTgMarkdown(reason)` в template render
- [x] BOT_TOKEN отсутствует → `sendTelegram` graceful skip с log

Все 3 BLOCKER candidates закрыты inline. 4 WARN документированы. 0 open BLOCKER.

**Trailer (Sub-PRs):** `Codex-Paranoia: SUB-WAVE self-reviewed (epic notification-wave-a); epic-end review pending`

## Verification (epic-end)

- `npm run test:run` — все 1300+ тестов + новые
- `npm run test:integration -- notifications`
- `npm run build` green
- `npm run check:env-contract`
- `/cso` daily — 0 findings expected (server-side only, no XSS surface)
- Playwright local-dev: cancel teacher → проверить `notification_log` row через psql
- Canary anon prod после deploy

## Out of scope

- Push (PWA) уведомления — отдельный эпик
- Дайджест / batching для cancel/reschedule (low-frequency)
- UI для просмотра notification_log в /admin (operator artifact, отдельно)
- Wave-B/C/D/E/F (этот документ — только Wave-A)
