-- mig 0116 — legal_document_versions.change_kind + auto-pass editorial.
--
-- Background. Migration 0115 chains an editorial successor row
-- (v1-2026-06-08-editorial) on top of v1-2026-06-01 to clear the
-- «Версия v2» drift. With the append-only rule preserved, every
-- teacher who already accepted v1-2026-06-01 would otherwise be
-- forced back through /saas-offer-accept on next login — which is
-- a poor UX for a non-material typo fix.
--
-- This migration:
--   1. Adds `change_kind` column ('material' | 'editorial', default
--      'material' so every existing row stays material).
--   2. Stamps the v1-2026-06-08-editorial row as 'editorial'.
--   3. Indexes (doc_kind, effective_from desc) where editorial — used
--      by the accept-gate to walk back through editorial successors
--      and find the last material ancestor a teacher consented to.
--
-- The accept-gate change itself lives in TS code
-- (lib/legal/saas-offer-gate.ts). This migration only ships the schema
-- that gate depends on.

alter table legal_document_versions
  add column if not exists change_kind text not null default 'material';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'legal_document_versions_change_kind_check'
       and conrelid = 'legal_document_versions'::regclass
  ) then
    alter table legal_document_versions
      add constraint legal_document_versions_change_kind_check
      check (change_kind in ('material', 'editorial'));
  end if;
end
$$;

create index if not exists legal_document_versions_editorial_idx
  on legal_document_versions (doc_kind, effective_from desc)
  where change_kind = 'editorial';

-- Backfill: the 0115 editorial row was inserted before this column
-- existed; flip it now. Idempotent (UPDATE with WHERE on label is safe
-- to re-run).
update legal_document_versions
   set change_kind = 'editorial'
 where doc_kind = 'saas_offer'
   and version_label = 'v1-2026-06-08-editorial'
   and change_kind <> 'editorial';

comment on column legal_document_versions.change_kind is
  'material = needs fresh acceptance; editorial = typo / metadata fix that '
  'auto-passes for teachers who already consented to the previous chain link.';
