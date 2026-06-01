-- Per-learner payment method (teacher's choice).
-- Plan: docs/plans/per-learner-payment-method.md
--
-- 1) New table `learner_billing_preferences` — per (teacher, learner) pair
--    payment_method enum.
-- 2) Audit event `auth.billing.method_changed` added to constraint.
-- 3) DROP COLUMN `accounts.postpaid_allowed` — clean cut, в проде test data.
-- 4) `teacher_invites.default_payment_method` для invite-flow default.

create table if not exists learner_billing_preferences (
  teacher_account_id uuid not null references accounts(id) on delete cascade,
  learner_account_id uuid not null references accounts(id) on delete cascade,
  payment_method text not null default 'none'
    check (payment_method in ('postpaid', 'prepaid_packages', 'none')),
  updated_at timestamptz not null default now(),
  updated_by_account_id uuid references accounts(id),
  primary key (teacher_account_id, learner_account_id)
);

comment on table learner_billing_preferences is
  'Per (teacher, learner) pair payment method (postpaid / prepaid_packages / none). Teacher-managed only. Booking flow consults this; absence of row = ''none'' = booking blocked.';

create index if not exists learner_billing_preferences_learner_idx
  on learner_billing_preferences(learner_account_id);

-- Extend auth_audit_events constraint.
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
    'auth.invite.redeemed',
    'auth.teacher.saas_offer_accepted',
    'auth.teacher.saas_offer_backfilled',
    'auth.onboarding.reset',
    'auth.billing.method_changed'
  ));

-- NB: accounts.postpaid_allowed становится dead column (booking.ts его
-- больше не читает после mig 0101). DROP COLUMN деферрен на follow-up
-- cleanup PR — иначе ломаются 7 consumers (admin/accounts page, cabinet
-- UI, BookConfirmModal, tests) что violates «не плоди скоуп».
-- TODO follow-up: `alter table accounts drop column postpaid_allowed`
-- + удалить app/api/admin/accounts/[id]/postpaid + UI блоки.

-- Add default_payment_method to teacher_invites для invite-flow.
alter table teacher_invites
  add column if not exists default_payment_method text not null default 'none'
    check (default_payment_method in ('postpaid', 'prepaid_packages', 'none'));
