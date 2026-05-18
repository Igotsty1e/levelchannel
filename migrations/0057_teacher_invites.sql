-- SAAS-3+4 TINV.1 (2026-05-18) — teacher invite-link table + audit-event
-- enum extension. Foundation for /api/teacher/invites endpoints (TINV.4)
-- and the atomic single-statement redeem-and-bind from §3.5 of
-- docs/plans/teacher-self-reg-invite.md.
--
-- Schema rationale:
--   - id (uuid PK) — surfaced in the invite token payload + revoke URL.
--   - teacher_account_id → accounts.id ON DELETE CASCADE
--     The invite row is purely an artifact of the inviting teacher.
--     If the teacher is hard-deleted, the invite goes with them.
--     Already-redeemed learners stay alive; their assigned_teacher_id
--     becomes NULL via the existing ON DELETE SET NULL on
--     accounts.assigned_teacher_id (handled in a separate FK).
--   - used_by_account_id → accounts.id ON DELETE SET NULL
--     Audit-trail of who redeemed the invite survives the learner's
--     own deletion.
--   - Single-use invariant: used_at IS NULL AND revoked_at IS NULL
--     AND expires_at > now(). Enforced atomically in the redeem
--     statement (TINV.3); no separate trigger needed.

create table if not exists teacher_invites (
  id uuid primary key default gen_random_uuid(),
  teacher_account_id uuid not null
    references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  used_by_account_id uuid null
    references accounts(id) on delete set null,
  revoked_at timestamptz null
);

create index if not exists teacher_invites_teacher_idx
  on teacher_invites (teacher_account_id, created_at desc);

-- Active invites only — supports the atomic redeem WHERE-clause shape
-- (id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()).
create index if not exists teacher_invites_active_idx
  on teacher_invites (id)
  where used_at is null and revoked_at is null;

-- Extend auth_audit_events.event_type CHECK with the 4 new invite events.
-- Drop + re-add is an ACCESS EXCLUSIVE lock for sub-second on a 50k-row
-- table — acceptable in a maintenance-window deploy. The table is
-- write-only and the recorder swallows errors, so brief lock contention
-- is invisible end-to-end.
alter table auth_audit_events
  drop constraint if exists auth_audit_events_event_type_check;
alter table auth_audit_events
  add constraint auth_audit_events_event_type_check
  check (event_type in (
    'auth.login.success',
    'auth.login.failed',
    'auth.register.created',
    'auth.reset.requested',
    'auth.reset.confirmed',
    'auth.verify.success',
    'auth.session.revoked',
    'auth.teacher.self_registered',
    'auth.invite.created',
    'auth.invite.revoked',
    'auth.invite.redeemed'
  ));
