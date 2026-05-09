-- Legal-versioning sister wave (prereq for billing wave).
--
-- Codex round 1 HIGH 6 of the billing-wave design called this a launch
-- blocker: with payment timing, package TTL, and cancellation economics
-- about to change in the oferta, every consent + purchase needs a
-- defensible answer to "what terms applied to me at the time".
--
-- This migration ships the MINIMUM VIABLE evidence chain:
--   1. legal_document_versions — full-text snapshot of every legal
--      document version with stable id + monotonic version_label +
--      effective_from + previous_version_id chain.
--   2. account_consents.legal_document_version_id — FK to the row that
--      was current at the moment of consent. Existing string column
--      `document_version` stays for backward compat; new consents
--      populate both the FK and the string.
--   3. Seed rows for the three documents currently live on the site:
--      offer, privacy, personal_data. These are version "v1" anchored
--      to the migration date; bodies are placeholders pointing at the
--      JSX page paths (full-body capture comes when the admin
--      Versions UI ships in a follow-up wave).
--
-- The body_md column is non-NULL in the schema but the seed values
-- are short stub strings; production deploy will follow up with a
-- one-time UPDATE inserting the real markdown snapshot of each
-- document. Until then the FK chain is intact and new consents are
-- recorded against version_id = v1.

create table if not exists legal_document_versions (
  id uuid primary key default gen_random_uuid(),
  doc_kind text not null check (doc_kind in (
    'offer',
    'privacy',
    'personal_data'
  )),
  version_label text not null,
  effective_from timestamptz not null default now(),
  body_md text not null,
  previous_version_id uuid null
    references legal_document_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by_account_id uuid null
    references accounts(id) on delete set null,

  -- Two rows of the same kind cannot share a version_label. Per-kind
  -- monotonic by effective_from is enforced at the application
  -- layer; the unique constraint prevents accidental duplicates.
  constraint legal_document_versions_kind_label_unique
    unique (doc_kind, version_label)
);

create index if not exists legal_document_versions_kind_effective_idx
  on legal_document_versions (doc_kind, effective_from desc);

-- FK from consent → version. Nullable because pre-existing rows
-- (before this migration) carry only the text version_label in the
-- legacy column. New consents populate both; old consents stay text-
-- only and are reconcilable via the kind+label join.
alter table account_consents
  add column if not exists legal_document_version_id uuid null
  references legal_document_versions(id) on delete restrict;

create index if not exists account_consents_legal_version_idx
  on account_consents (legal_document_version_id)
  where legal_document_version_id is not null;

-- Seed initial v1 rows for the three documents currently live.
-- Body content is a stub pointing at the JSX page; production
-- follow-up replaces these with the real markdown snapshot in a
-- separate operator-driven UPDATE.
insert into legal_document_versions (doc_kind, version_label, effective_from, body_md)
values
  ('offer', 'v1', now(),
   '# Публичная оферта (v1)' || E'\n\n' ||
   '_Полный текст: см. https://levelchannel.ru/offer на момент эффективной даты._' || E'\n\n' ||
   '_Эта запись является эвиденс-якорем для согласий, оформленных до запуска UI управления версиями._'),
  ('privacy', 'v1', now(),
   '# Политика обработки персональных данных (v1)' || E'\n\n' ||
   '_Полный текст: см. https://levelchannel.ru/privacy на момент эффективной даты._'),
  ('personal_data', 'v1', now(),
   '# Согласие на обработку персональных данных (v1)' || E'\n\n' ||
   '_Полный текст: см. https://levelchannel.ru/consent/personal-data на момент эффективной даты._')
on conflict (doc_kind, version_label) do nothing;
