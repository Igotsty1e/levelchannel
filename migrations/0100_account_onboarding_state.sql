-- ONBOARDING wave Sub-PR A foundation.
-- Spec: docs/plans/onboarding-tooltips-spec-2026-05-31.md §2 (persistence).
--
-- Один account_id ↔ один row с JSONB `dismissed_hints`. Whitelist ключей
-- хранится в коде (`lib/onboarding/keys.ts`), а не в DB constraint —
-- добавление 12-го hint'а в Sub-PR D НЕ требует миграции, только
-- обновления `ONBOARDING_HINT_KEYS` массива.
--
-- Plus: расширяем `auth_audit_events.event_type_check` на новый
-- `auth.onboarding.reset` event — для admin CLI `scripts/onboarding-
-- reset.ts` (см. §3.3 спеки). Pattern drop+re-add из mig 0057:47.
--
-- Spec referenced this как mig 0099, но 0099 ушёл под SaaS go-live
-- (PR #463) — реальный номер 0100. Spec будет обновлён в этом же PR.

create table if not exists account_onboarding_state (
  account_id uuid primary key references accounts(id) on delete cascade,
  dismissed_hints jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table account_onboarding_state is
  'Per-account onboarding hint dismissal state. JSONB shape lets us add new hints in Sub-PR D without a migration. Keys validated against ONBOARDING_HINT_KEYS in lib/onboarding/keys.ts.';

comment on column account_onboarding_state.dismissed_hints is
  'Map of hint_key (whitelisted) → ISO timestamp string of dismissal. Empty object means user has dismissed nothing yet.';

-- Extend auth_audit_events.event_type_check.
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
    'auth.onboarding.reset'
  ));
