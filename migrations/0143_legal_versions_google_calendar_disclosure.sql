-- 0143: publish v3 of `privacy` + `personal_data` — adds the Google Calendar
-- integration disclosure (data accessed via Google API, purpose, minimal
-- OAuth scopes, Limited Use commitment, revocation) required by the Google
-- API Services User Data Policy before the OAuth app can pass verification.
-- Sister change to the lib/legal bump
-- PERSONAL_DATA_DOCUMENT_VERSION '2026-06-27.1' -> '2026-06-28.1'.
--
-- Versioning model (from migration 0032): new acceptances bind the CURRENT
-- version via getCurrentLegalVersion(); existing consents keep their prior
-- version FK (audit-trail, history is not collapsed). v3 becomes current
-- because its effective_from = now() is the latest <= now().
--
-- body_md stays a stub anchor pointing at the live JSX page, same as the
-- v1 seed rows in 0032 and the v2 rows in 0142. The real markdown snapshot
-- is an operator follow-up.

insert into legal_document_versions (doc_kind, version_label, effective_from, body_md, previous_version_id)
values
  ('privacy', 'v3', now(),
   '# Политика обработки персональных данных (v3)' || E'\n\n' ||
   '_Изменение: добавлено раскрытие интеграции с Google Календарём (доступ к данным календаря Учителя через Google API, цели, минимальные OAuth scopes, обязательство Limited Use, порядок отзыва доступа)._' || E'\n\n' ||
   '_Полный текст: см. https://levelchannel.ru/privacy на момент эффективной даты._',
   (select id from legal_document_versions where doc_kind = 'privacy' and version_label = 'v2')),
  ('personal_data', 'v3', now(),
   '# Согласие на обработку персональных данных (v3)' || E'\n\n' ||
   '_Изменение: синхронизация версии с Политикой v3 (раскрытие интеграции с Google Календарём в Политике); текст согласия для плательщиков по существу не изменён._' || E'\n\n' ||
   '_Полный текст: см. https://levelchannel.ru/consent/personal-data на момент эффективной даты._',
   (select id from legal_document_versions where doc_kind = 'personal_data' and version_label = 'v2'))
on conflict (doc_kind, version_label) do nothing;
