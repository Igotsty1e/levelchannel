-- SAAS-OFFER bundle A1 follow-up (2026-05-31) — расширение
-- legal-versioning под Приложение № 1 «Условия поручения оператора
-- учителю».
--
-- Контекст: PR #452 ввёл документ Приложения № 1 как обязательный
-- спутник v2 SaaS-оферты. Без публикации Приложения по
-- /saas/processor-terms ссылка из §6.3.2 v2 оферты ведёт в 404, и
-- конструкция «учитель действует по поручению» по ч. 3 ст. 6 № 152-ФЗ
-- теряет правовое основание.
--
-- Что эта миграция шипит:
--
--   1. legal_document_versions.doc_kind CHECK расширяется значением
--      `saas_processor_terms` (по аналогии с mig 0096 для saas_offer).
--   2. account_consents.document_kind CHECK расширяется тем же значением
--      на случай, если в будущем мы введём отдельный consent на
--      Приложение (currently single saas_offer consent покрывает оба,
--      см. ANSWERS Q5 в Приложении № 1).
--   3. Seed-строка `v0-placeholder-do-not-accept` для saas_processor_terms.
--      Тот же hard-reject pattern как у saas_offer: гейт-предикат
--      `evaluateSaasOfferGate` отвергает любую версию с префиксом
--      `v0-placeholder-`, /saas-offer-accept SSR redirect на
--      /saas-offer-awaiting. Admin публикует реальную v1 через
--      `/admin/legal` после mig deploy.
--
-- ALTER ... DROP CONSTRAINT / ADD CONSTRAINT — ACCESS EXCLUSIVE для
-- sub-секунды на низкоразмерных таблицах. Окно невидимое end-to-end.

-- (1) legal_document_versions.doc_kind CHECK extension.
alter table legal_document_versions
  drop constraint if exists legal_document_versions_doc_kind_check;
alter table legal_document_versions
  add constraint legal_document_versions_doc_kind_check
  check (doc_kind in (
    'offer',
    'privacy',
    'personal_data',
    'saas_offer',
    'saas_processor_terms'
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
    'saas_offer',
    'saas_processor_terms'
  ));

-- (3) Seed v0-placeholder-do-not-accept for saas_processor_terms.
insert into legal_document_versions (doc_kind, version_label, effective_from, body_md)
values
  ('saas_processor_terms', 'v0-placeholder-do-not-accept', now(),
   '## ВНИМАНИЕ' || E'\n\n' ||
   'Это placeholder-запись Приложения № 1 «Условия поручения оператора учителю» к SaaS-оферте.' || E'\n\n' ||
   'Реальная редакция будет опубликована администратором через `/admin/legal` ВМЕСТЕ с v1 SaaS-оферты — иначе ссылка из v2 оферты §6.3.2 на /saas/processor-terms ведёт в 404.' || E'\n\n' ||
   'Гейт (`evaluateSaasOfferGate`) отвергает версии с префиксом `v0-placeholder-` явно (HTTP 503 `saas_offer_awaiting_publication`).')
on conflict (doc_kind, version_label) do nothing;
