-- mig 0141 — teacher-lessons-edit-status epic (2026-06-24).
--
-- Plan: docs/plans/teacher-lessons-edit-status-2026-06-24.md
--
-- Audit log для status-change операций через `change-status` endpoint.
-- Запись пишется ТОЛЬКО внутри TX status-change'а (Sub-PR 1 contract).
--
-- Семантика полей:
--   actor_account_id   — учитель, инициировавший изменение (NULL после удаления учётки).
--   actor_role         — пока только 'teacher'; admin-flow это отдельный эпик с расширением CHECK.
--   learner_account_id — ученик урока. NULL для дел (`source='deal'`) ИЛИ после удаления учётки.
--   source             — 'lesson' для уроков (lesson_completions-backed) или 'deal' (personal_event).
--   from_status        — статус ДО mutation. Lesson: 'completed'|'no_show_learner'|'no_show_teacher'|'booked'.
--                        Deal: 'personal_event'|'completed'|'cancelled'.
--   to_status          — целевой статус.
--   notify_intent      — учитель поставил чекбокс «уведомить ученика» (intent).
--   notify_dispatched_at — момент `dispatchLessonEvent` attempt; NULL если skip
--                          (intent off, preferences blocked, rate-limited 1 day).
--   ts                 — момент status change (UTC).
--
-- FK semantics:
--   slot_id            — CASCADE: при удалении слота из fixture cleanup audit row уходит вместе.
--   actor/learner FKs  — SET NULL: позволяет fixture/e2e teardown удалять accounts без FK violation
--                        (см. tests/e2e/seed.mjs teardown contract).
--
-- Rate-limit lookup uses partial index on (actor, slot, notify_dispatched_at) WHERE NOT NULL.

create table if not exists audit_lesson_status_change (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references lesson_slots(id) on delete cascade,
  actor_account_id uuid null references accounts(id) on delete set null,
  actor_role text not null check (actor_role = 'teacher'),
  learner_account_id uuid null references accounts(id) on delete set null,
  source text not null check (source in ('lesson', 'deal')),
  from_status text not null,
  to_status text not null,
  notify_intent boolean not null default false,
  notify_dispatched_at timestamptz null,
  ts timestamptz not null default now()
);

create index if not exists audit_lesson_status_change_slot_idx
  on audit_lesson_status_change (slot_id, ts desc);

create index if not exists audit_lesson_status_change_actor_idx
  on audit_lesson_status_change (actor_account_id, ts desc);

create index if not exists audit_lesson_status_change_notify_rate_idx
  on audit_lesson_status_change (actor_account_id, slot_id, notify_dispatched_at)
  where notify_dispatched_at is not null;

comment on table audit_lesson_status_change is
  'teacher-lessons-edit-status epic (2026-06-24): audit trail for /change-status mutations. Plan: docs/plans/teacher-lessons-edit-status-2026-06-24.md';
comment on column audit_lesson_status_change.notify_intent is
  'Учитель поставил чекбокс «уведомить ученика». Только intent — НЕ доказательство delivery.';
comment on column audit_lesson_status_change.notify_dispatched_at is
  'Момент dispatchLessonEvent attempt; NULL если skipped (intent off, preferences blocked, rate-limited).';
