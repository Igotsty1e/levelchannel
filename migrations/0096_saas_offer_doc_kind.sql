-- SAAS-OFFER bundle (Sub-A.2-3-5) — extends the legal-versioning
-- infrastructure (mig 0032) with the `saas_offer` document kind.
--
-- What this migration ships:
--
--   1. legal_document_versions.doc_kind CHECK gains `saas_offer`.
--   2. account_consents.document_kind CHECK gains `saas_offer`.
--   3. auth_audit_events.event_type CHECK gains two new types:
--      - `auth.teacher.saas_offer_accepted` (interstitial accept path)
--      - `auth.teacher.saas_offer_backfilled` (admin backfill script)
--   4. Seed row for `saas_offer` doc_kind = `v0-placeholder-do-not-accept`.
--      This is NOT a real оферта — it is the explicit hard-reject signal
--      consumed by the gate predicate. Both the Sub-A.3 server gate AND
--      the Sub-A.5 cabinet gate REJECT any version whose label starts with
--      `v0-placeholder-`. Admin replaces with real v1 via
--      `createLegalVersion('saas_offer', 'v1', <legal-rf-signed-off body>)`
--      via the admin UI POST-deploy.
--
-- Why a placeholder row at all: the CHECK constraint on doc_kind must be
-- satisfied for ANY row insertion at that doc_kind to compile. New routes
-- like /saas/offer exist immediately after deploy; without the placeholder
-- the route would throw on first request (getCurrentLegalVersion returns
-- null and the page has no fallback). With the placeholder, the gate
-- recognises it explicitly and emits the canonical
-- `saas_offer_awaiting_publication` 503 — a state both the cabinet
-- interstitial AND the registration flow handle gracefully.
--
-- ALTER ... DROP CONSTRAINT / ADD CONSTRAINT is ACCESS EXCLUSIVE for
-- sub-second on the affected tables. legal_document_versions and
-- account_consents are write-mostly low-volume tables; auth_audit_events
-- is write-only with swallow-on-error semantics. Brief lock contention
-- is invisible end-to-end.

-- (1) legal_document_versions.doc_kind CHECK extension.
alter table legal_document_versions
  drop constraint if exists legal_document_versions_doc_kind_check;
alter table legal_document_versions
  add constraint legal_document_versions_doc_kind_check
  check (doc_kind in (
    'offer',
    'privacy',
    'personal_data',
    'saas_offer'
  ));

-- (2) account_consents.document_kind CHECK extension.
alter table account_consents
  drop constraint if exists account_consents_document_kind_check;
alter table account_consents
  add constraint account_consents_document_kind_check
  check (document_kind in (
    'personal_data',
    'offer',
    'marketing_opt_in',
    'parent_consent',
    'saas_offer'
  ));

-- (3) auth_audit_events.event_type CHECK extension.
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
    'auth.teacher.saas_offer_backfilled'
  ));

-- (4) Seed v0-placeholder-do-not-accept for saas_offer.
-- Body is the rejection notice — never accepted by the gate; visible
-- in admin UI as a "you have not published yet" reminder.
insert into legal_document_versions (doc_kind, version_label, effective_from, body_md)
values
  ('saas_offer', 'v0-placeholder-do-not-accept', now(),
   '## ВНИМАНИЕ' || E'\n\n' ||
   'Это placeholder-запись. Реальная SaaS-оферта будет опубликована администратором после legal-rf SIGN-OFF.' || E'\n\n' ||
   'Гейт принципиально не принимает согласие на этот текст: версии с префиксом `v0-placeholder-` отвергаются явно (HTTP 503 `saas_offer_awaiting_publication`).' || E'\n\n' ||
   'После публикации v1 (через admin UI `/admin/legal`) гейт включается в работу.')
on conflict (doc_kind, version_label) do nothing;
