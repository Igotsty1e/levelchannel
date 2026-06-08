-- mig 0117 — editorial revision saas_offer (continuation of mig 0115)
--
-- Chains v1-2026-06-09-editorial-2 OFF v1-2026-06-08-editorial.
--
-- Three editorial substitutions, all NON-MATERIAL per ст. 450 ГК
-- (no numbered clause changes its legal substance; названия тарифов
-- получают человекочитаемые алиасы, контактный email и подсудность
-- унифицируются с реальной локацией ИП):
--
--   1) Tariff aliases: "Тариф Free" → "Тариф Free (Стартовый)",
--      "Тариф Mid" → "Тариф Mid (Базовый)",
--      "Тариф Pro" → "Тариф Pro (Расширенный)".
--      Закрывает расхождение между офертой и публичным посадочным
--      (ЗоЗПП ст. 10 — недостоверная информация о товаре).
--
--   2) Email: igotstyle227@gmail.com → support@levelchannel.ru.
--      Унифицируется с публичным каналом в подвале. CloudPayments-
--      модератор/Роспотребнадзор не любит частный gmail в оферте.
--
--   3) Court: Арбитражный суд Челябинской области → Смоленской области.
--      Подсудность приводится к реальной локации ИП (заявленные
--      адреса в §10.2 и contact-block: г. Смоленск). Договорная
--      подсудность для ИП-учителей и самозанятых; для Учителей-
--      потребителей §10.3.2 остаётся без изменений (выбор Потребителя
--      по ЗоЗПП).
--
--   4) Place of contract: «Место заключения договора: г. Челябинск»
--      → «г. Смоленск». Открывающий и закрывающий header.
--
--   5) §2.4 «До этой даты заключение договора по платному тарифу
--      осуществляется по индивидуальному запросу через адрес ...»
--      удаляется: self-serve activated на момент публикации новой
--      редакции. Оставляем активирующий smaller wording.
--
-- Append-only chain: previous_version_id = id of v1-2026-06-08-editorial.
-- Existing consents to older versions сохраняют trail.

do $migration$
declare
  v_old_id uuid;
  v_old_body text;
  v_new_body text;
  v_new_id uuid;
begin
  -- Locate the predecessor row (editorial-1).
  select id, body_md
    into v_old_id, v_old_body
    from legal_document_versions
   where doc_kind = 'saas_offer'
     and version_label = 'v1-2026-06-08-editorial'
   limit 1;

  if v_old_id is null then
    raise notice 'mig 0117: editorial-1 row not found — skipping (clean test DB or mig 0115 not applied yet)';
    return;
  end if;

  -- Idempotency: skip if editorial-2 already chained.
  perform 1
     from legal_document_versions
    where doc_kind = 'saas_offer'
      and version_label = 'v1-2026-06-09-editorial-2';
  if found then
    raise notice 'mig 0117: editorial-2 row already present — skipping';
    return;
  end if;

  -- Per-kind advisory lock (mirrors createLegalVersion).
  perform pg_advisory_xact_lock(hashtext('legal:saas_offer'));

  v_new_body := v_old_body;

  -- 1) Tariff aliases — humanise § 3 names.
  v_new_body := replace(v_new_body, '### 3.1. Тариф Free', '### 3.1. Тариф Free (Стартовый)');
  v_new_body := replace(v_new_body, '### 3.2. Тариф Mid', '### 3.2. Тариф Mid (Базовый)');
  v_new_body := replace(v_new_body, '### 3.3. Тариф Pro', '### 3.3. Тариф Pro (Расширенный)');
  -- В body можно встретить «тарифов Mid и Pro» — оставляем без алиаса,
  -- чтобы не плодить (Базовый) внутри каждого упоминания.

  -- 2) Email unification.
  v_new_body := replace(v_new_body, 'igotstyle227@gmail.com', 'support@levelchannel.ru');

  -- 3) Court substitution — Челябинская → Смоленская.
  v_new_body := replace(
    v_new_body,
    'Арбитражном суде Челябинской области',
    'Арбитражном суде Смоленской области'
  );

  -- 4) Place of contract — Челябинск → Смоленск (oba header'a).
  v_new_body := replace(
    v_new_body,
    'Место заключения договора: г. Челябинск.',
    'Место заключения договора: г. Смоленск.'
  );

  -- 5) §2.4 — drop "до этой даты — через индивидуальный запрос" sentence.
  --    Self-serve активирован к моменту публикации этой редакции.
  --    Оставляем лидирующее предложение пункта.
  v_new_body := replace(
    v_new_body,
    '2.4. Доступ к платным тарифам в режиме самостоятельной оплаты (self-serve) открывается с даты ввода Платформой в эксплуатацию автоматического платёжного контура. До этой даты заключение договора по платному тарифу осуществляется по индивидуальному запросу Учителя через адрес support@levelchannel.ru.',
    '2.4. Доступ к платным тарифам в режиме самостоятельной оплаты (self-serve) активирован.'
  );

  -- 6) Update opening version stamp.
  v_new_body := replace(
    v_new_body,
    'Версия v1, редакция от 1 июня 2026 г. (техническая правка от 8 июня 2026 г.).',
    'Версия v1, редакция от 1 июня 2026 г. (технические правки от 8 и 9 июня 2026 г.).'
  );

  -- 7) Update closing version stamp.
  v_new_body := replace(
    v_new_body,
    'Версия v1. Дата редакции: 1 июня 2026 г.',
    'Версия v1, редакция от 1 июня 2026 г. (технические правки от 8 и 9 июня 2026 г.).'
  );

  -- Defensive: must have changed at least one substring.
  if v_new_body = v_old_body then
    raise exception 'mig 0117: no substitutions matched — source body drift; aborting';
  end if;

  -- change_kind = 'editorial' критично: позволяет evaluateSaasOfferGate
  -- walk через previous_version_id chain (mig 0116) и автопропустить
  -- существующих teachers'ов, акцептовавших предыдущие editorial-row.
  -- Без явного 'editorial' default 'material' (mig 0116) сломал бы
  -- chain → forced re-accept на /saas-offer-accept для всех.
  insert into legal_document_versions
    (doc_kind, version_label, effective_from, body_md,
     previous_version_id, created_by_account_id, change_kind)
  values
    ('saas_offer',
     'v1-2026-06-09-editorial-2',
     now(),
     v_new_body,
     v_old_id,
     null,
     'editorial')
  returning id into v_new_id;

  raise notice 'mig 0117: editorial-2 row % chained to %', v_new_id, v_old_id;
end
$migration$;
