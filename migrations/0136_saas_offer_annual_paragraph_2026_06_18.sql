-- mig 0136 — A.2 annual «Оптимальный на год» editorial revision saas_offer.
--
-- Editorial-4 chain: v1-2026-06-18-editorial-4 OFF v1-2026-06-18-editorial-3.
--
-- Adds a new sub-paragraph §3.2.1 «Оптимальный на год» под §3.2:
--   — Стоимость: 4 000 ₽ разовым платежом за 365 дней.
--   — Лимит активных учеников: не ограничен.
--   — Период: 365 (триста шестьдесят пять) дней с момента оплаты.
--   — Без авто-продления: следующий период оплачивается отдельным
--     действием в личном кабинете.
--
-- Pre-flight: тот же что в mig 0135 — abort if > 1 active mid/pro
-- subscription. Зеркалит инвариант (owner: активных платных подписок нет).
--
-- Legal-Pipeline-Verified обязателен в commit message — мигра трогает
-- регулируемый текст оферты.

do $migration$
declare
  v_old_id uuid;
  v_old_body text;
  v_new_body text;
  v_new_id uuid;
  v_active_paid_count integer;
  v_section_annual text;
begin
  -- (0) Pre-flight invariant.
  select count(*) into v_active_paid_count
    from teacher_subscriptions
   where state = 'active'
     and plan_slug in ('mid', 'pro');

  if v_active_paid_count > 1 then
    raise exception
      'mig 0136 aborted: % active paid subscription(s) on mid/pro detected. '
      'Annual tariff rollout requires explicit owner handoff before any '
      'price-related offer revision can be published.', v_active_paid_count;
  end if;

  -- (1) Locate the previous editorial revision (mig 0135 editorial-3).
  select id, body_md
    into v_old_id, v_old_body
    from legal_document_versions
   where doc_kind = 'saas_offer'
     and version_label = 'v1-2026-06-18-editorial-3'
   limit 1;

  if v_old_id is null then
    raise notice 'mig 0136: editorial-3 row not found — skipping (clean test DB or mig 0135 not applied yet)';
    return;
  end if;

  -- (2) Idempotency.
  perform 1
     from legal_document_versions
    where doc_kind = 'saas_offer'
      and version_label = 'v1-2026-06-18-editorial-4';
  if found then
    raise notice 'mig 0136: editorial-4 row already present — skipping';
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('legal:saas_offer'));

  v_new_body := v_old_body;

  -- (3) Append §3.2.1 «Оптимальный на год» прямо после §3.2 (последняя
  --     строка которого — «Списание автоматическое в порядке раздела 4.»).
  --     Используем точное соответствие хвоста §3.2 для безопасной inject.
  v_section_annual :=
    E'\n\n### 3.2.1. Тариф «Оптимальный на год»' || E'\n' ||
    E'\n' ||
    '— Стоимость: 4 000 (четыре тысячи) рублей разовым платежом за один Период тарифа.' || E'\n' ||
    '— Лимит активных учеников: не ограничен.' || E'\n' ||
    '— Период тарифа: 365 (триста шестьдесят пять) календарных дней с момента поступления оплаты.' || E'\n' ||
    '— Списание разовое, авто-продление не предусмотрено. По истечении Периода Учитель самостоятельно оплачивает следующий годовой Период либо переходит на тариф «Mid (Оптимальный)» месяц-в-месяц.' || E'\n' ||
    '— Возврат части стоимости при досрочной отмене регулируется разделом 8 настоящей оферты пропорционально неиспользованной части Периода.';

  v_new_body := replace(
    v_new_body,
    '### 3.2. Тариф Mid (Оптимальный)' || E'\n' ||
    E'\n' ||
    '— Стоимость: 399 (триста девяносто девять) рублей за один Период тарифа, либо иная сумма, опубликованная в Прейскуранте на дату списания.' || E'\n' ||
    '— Лимит активных учеников: не ограничен.' || E'\n' ||
    '— Период тарифа: 1 (один) календарный месяц.' || E'\n' ||
    '— Списание автоматическое в порядке раздела 4.',
    '### 3.2. Тариф Mid (Оптимальный)' || E'\n' ||
    E'\n' ||
    '— Стоимость: 399 (триста девяносто девять) рублей за один Период тарифа, либо иная сумма, опубликованная в Прейскуранте на дату списания.' || E'\n' ||
    '— Лимит активных учеников: не ограничен.' || E'\n' ||
    '— Период тарифа: 1 (один) календарный месяц.' || E'\n' ||
    '— Списание автоматическое в порядке раздела 4.' ||
    v_section_annual
  );

  -- (4) Defensive — substitution should change the body.
  if v_new_body = v_old_body then
    raise exception 'mig 0136: §3.2 annual paragraph injection failed — source body drift; aborting';
  end if;

  -- (5) Insert append-only chain.
  insert into legal_document_versions
    (doc_kind, version_label, effective_from, body_md,
     previous_version_id, created_by_account_id, change_kind)
  values
    ('saas_offer',
     'v1-2026-06-18-editorial-4',
     now(),
     v_new_body,
     v_old_id,
     null,
     'editorial')
  returning id into v_new_id;

  raise notice 'mig 0136: editorial-4 row % chained to %', v_new_id, v_old_id;
end
$migration$;
