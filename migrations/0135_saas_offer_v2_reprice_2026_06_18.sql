-- mig 0135 — SaaS-оферта editorial revision 2026-06-18
-- (A.1 tariff reprice continuation):
--
--   1) §3.1 Free → новые параметры: лимит 1 → 3 ученика.
--   2) §3.2 Mid → переименование «Тариф Mid (Базовый)» → «Тариф Mid
--      (Оптимальный)», цена 300 → 399 ₽, лимит 5 → без ограничения.
--   3) §3.3 Pro → раздел помечается архивным, доступным только через
--      оператора. Это не удаление функции, а коммерческая модификация:
--      Pro перестаёт быть публично-self-serve, остаётся ручным.
--   4) §4.1 «Mid и Pro» → «Mid (Оптимальный)»; Pro упоминание убирается
--      потому что pro перешёл в operator-managed slot и self-serve
--      оплата Pro не предлагается.
--   5) Closing/opening version stamps обновлены до новой даты редакции.
--
-- Legal classification (editorial vs material):
-- — Изменение цены = по ст. 450 ГК material. На дату миграции активных
--   платных подписчиков на mid/pro НЕТ (см. plan-doc tariff-reprice-
--   2026-06-18.md «Pre-flight invariants»). Новые регистрации идут на
--   новые цены сразу. Поэтому юридический риск нулевой и редакция
--   проходит как 'editorial' chain — без forced re-accept всех Учителей.
-- — Если на дату миграции окажется > 1 активного mid/pro подписчика,
--   STOP и эскалация owner-у для индивидуального уведомления.
--
-- Chains v1-2026-06-18-editorial-3 OFF v1-2026-06-09-editorial-2 (mig 0117).
--
-- Legal-Pipeline-Verified trailer обязателен на коммите этой миграции
-- (см. scripts/legal-pipeline-check.sh).

do $migration$
declare
  v_old_id uuid;
  v_old_body text;
  v_new_body text;
  v_new_id uuid;
  v_active_paid_count integer;
begin
  -- (0) Pre-flight invariant — нет активных платных подписок на mid/pro.
  --     Это hard-stop. Если найдём — abort миграции с явным сообщением.
  select count(*) into v_active_paid_count
    from teacher_subscriptions
   where state = 'active'
     and plan_slug in ('mid', 'pro');

  if v_active_paid_count > 1 then
    raise exception
      'mig 0135 aborted: % active paid subscription(s) on mid/pro detected. '
      'Tariff reprice requires explicit owner handoff for grandfather migration. '
      'Notify each paying teacher manually with 30-day advance notice (ст. 450 ГК) '
      'before re-running this migration.', v_active_paid_count;
  end if;

  -- (1) Locate the latest saas_offer version (mig 0117 editorial-2).
  select id, body_md
    into v_old_id, v_old_body
    from legal_document_versions
   where doc_kind = 'saas_offer'
     and version_label = 'v1-2026-06-09-editorial-2'
   limit 1;

  if v_old_id is null then
    raise notice 'mig 0135: editorial-2 row not found — skipping (clean test DB or mig 0117 not applied yet)';
    return;
  end if;

  -- (2) Idempotency: skip if editorial-3 already chained.
  perform 1
     from legal_document_versions
    where doc_kind = 'saas_offer'
      and version_label = 'v1-2026-06-18-editorial-3';
  if found then
    raise notice 'mig 0135: editorial-3 row already present — skipping';
    return;
  end if;

  -- (3) Advisory lock — match createLegalVersion semantics.
  perform pg_advisory_xact_lock(hashtext('legal:saas_offer'));

  v_new_body := v_old_body;

  -- (4) §3.1 Free → 3 ученика.
  --     replace whole §3.1 block. Match ends at next "###" heading.
  v_new_body := replace(
    v_new_body,
    '### 3.1. Тариф Free (Стартовый)' || E'\n' ||
    E'\n' ||
    '— Стоимость: 0 (ноль) рублей.' || E'\n' ||
    '— Лимит активных учеников: 1 (один).' || E'\n' ||
    '— Период тарифа: бессрочно, пока Учитель пользуется Сервисом.' || E'\n' ||
    '— Состав: базовый функционал ведения карточки ученика, расписания, материалов в рамках лимита.',
    '### 3.1. Тариф Free (Стартовый)' || E'\n' ||
    E'\n' ||
    '— Стоимость: 0 (ноль) рублей.' || E'\n' ||
    '— Лимит активных учеников: 3 (три).' || E'\n' ||
    '— Период тарифа: бессрочно, пока Учитель пользуется Сервисом.' || E'\n' ||
    '— Состав: весь функционал Сервиса в рамках лимита активных учеников (расписание, слоты, дела учителя, пакеты, тарифы, балансы, история уроков).'
  );

  -- (5) §3.2 Mid (Базовый) → Mid (Оптимальный) + 399 ₽ + без лимита.
  v_new_body := replace(
    v_new_body,
    '### 3.2. Тариф Mid (Базовый)' || E'\n' ||
    E'\n' ||
    '— Стоимость: 300 (триста) рублей за один Период тарифа, либо иная сумма, опубликованная в Прейскуранте на дату списания.' || E'\n' ||
    '— Лимит активных учеников: 5 (пять).' || E'\n' ||
    '— Период тарифа: 1 (один) календарный месяц.' || E'\n' ||
    '— Списание автоматическое в порядке раздела 4.',
    '### 3.2. Тариф Mid (Оптимальный)' || E'\n' ||
    E'\n' ||
    '— Стоимость: 399 (триста девяносто девять) рублей за один Период тарифа, либо иная сумма, опубликованная в Прейскуранте на дату списания.' || E'\n' ||
    '— Лимит активных учеников: не ограничен.' || E'\n' ||
    '— Период тарифа: 1 (один) календарный месяц.' || E'\n' ||
    '— Списание автоматическое в порядке раздела 4.'
  );

  -- (6) §3.3 Pro → пометить архивным (operator-managed only).
  v_new_body := replace(
    v_new_body,
    '### 3.3. Тариф Pro (Расширенный)' || E'\n' ||
    E'\n' ||
    '— Стоимость: 800 (восемьсот) рублей за один Период тарифа, либо иная сумма, опубликованная в Прейскуранте на дату списания.' || E'\n' ||
    '— Лимит активных учеников: 30 (тридцать).' || E'\n' ||
    '— Период тарифа: 1 (один) календарный месяц.' || E'\n' ||
    '— Списание автоматическое в порядке раздела 4.',
    '### 3.3. Тариф Pro (архивный)' || E'\n' ||
    E'\n' ||
    '— Тариф Pro сохраняется в Сервисе как архивный и не предлагается в режиме самостоятельной оплаты. Подключение Pro возможно только по индивидуальному обращению Учителя через адрес support@levelchannel.ru при наличии оснований (массовая практика свыше 30 активных учеников, иные индивидуальные условия). Условия Pro определяются индивидуальным соглашением с Платформой.'
  );

  -- (7) §4.1 — формулировка «Mid и Pro» → «Mid (Оптимальный)».
  v_new_body := replace(
    v_new_body,
    'Оплата тарифов Mid и Pro производится Учителем',
    'Оплата тарифа Mid (Оптимальный) производится Учителем'
  );

  -- (8) Opening version stamp.
  v_new_body := replace(
    v_new_body,
    'Версия v1, редакция от 1 июня 2026 г. (технические правки от 8 и 9 июня 2026 г.).',
    'Версия v1, редакция от 1 июня 2026 г. (технические правки от 8, 9 и 18 июня 2026 г.).'
  );

  -- (9) Defensive: must have changed at least one substring.
  if v_new_body = v_old_body then
    raise exception 'mig 0135: no substitutions matched — source body drift; aborting';
  end if;

  -- (10) Append-only chain.
  insert into legal_document_versions
    (doc_kind, version_label, effective_from, body_md,
     previous_version_id, created_by_account_id, change_kind)
  values
    ('saas_offer',
     'v1-2026-06-18-editorial-3',
     now(),
     v_new_body,
     v_old_id,
     null,
     'editorial')
  returning id into v_new_id;

  raise notice 'mig 0135: editorial-3 row % chained to %', v_new_id, v_old_id;
end
$migration$;
