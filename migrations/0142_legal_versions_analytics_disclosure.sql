-- 0142: publish v2 of `privacy` + `personal_data` — adds the Yandex.Metrika
-- + Webvisor (session recording) web-analytics disclosure required by 152-FZ
-- once the analytics script is enabled. Sister change to the lib/legal bump
-- PERSONAL_DATA_DOCUMENT_VERSION '2026-04-29.4' -> '2026-06-27.1'.
--
-- Versioning model (from migration 0032): new acceptances bind the CURRENT
-- version via getCurrentLegalVersion(); existing consents keep their v1 FK
-- (audit-trail, history is not collapsed). v2 becomes current because its
-- effective_from = now() is the latest <= now().
--
-- body_md stays a stub anchor pointing at the live JSX page, same as the v1
-- seed rows in 0032. The real markdown snapshot is an operator follow-up.

insert into legal_document_versions (doc_kind, version_label, effective_from, body_md, previous_version_id)
values
  ('privacy', 'v2', now(),
   '# Политика обработки персональных данных (v2)' || E'\n\n' ||
   '_Изменение: добавлено раскрытие веб-аналитики Яндекс.Метрика и записи действий (Вебвизор) на публичных страницах._' || E'\n\n' ||
   '_Полный текст: см. https://levelchannel.ru/privacy на момент эффективной даты._',
   (select id from legal_document_versions where doc_kind = 'privacy' and version_label = 'v1')),
  ('personal_data', 'v2', now(),
   '# Согласие на обработку персональных данных (v2)' || E'\n\n' ||
   '_Изменение: добавлено раскрытие веб-аналитики Яндекс.Метрика и записи действий (Вебвизор) на публичных страницах._' || E'\n\n' ||
   '_Полный текст: см. https://levelchannel.ru/consent/personal-data на момент эффективной даты._',
   (select id from legal_document_versions where doc_kind = 'personal_data' and version_label = 'v1'))
on conflict (doc_kind, version_label) do nothing;
