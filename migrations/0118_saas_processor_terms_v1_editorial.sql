-- mig 0118 — editorial revision saas_processor_terms (matches mig 0117 polish for saas_offer)
--
-- Production smoke test caught: /saas/processor-terms still rendered
-- `igotstyle227@gmail.com` after mig 0117 cleaned saas_offer. The two
-- documents are separate chains; mig 0117 only touched saas_offer.
--
-- Substitutions (non-material per ст. 450 ГК):
--   1) Email: igotstyle227@gmail.com → support@levelchannel.ru (4 occurrences
--      in body — §3 dispatch, §16 contact-block; both editorial cleanup
--      tied to mig 0117 unification of public contact channel).
--   2) Court: Арбитражный суд Челябинской области → Смоленской области
--      (§16.2). Договорная подсудность, не процессуальная.
--   3) Place of contract: Челябинск → Смоленск (opening + closing headers).
--   4) Version stamp updated.
--
-- Append-only chain: new row v1-2026-06-09-editorial chains from
-- v1-2026-06-01 with change_kind = 'editorial'. Existing consents to
-- v1-2026-06-01 auto-pass via isEditorialOnlyChain walk (mig 0116).

do $migration$
declare
  v_old_id uuid;
  v_old_body text;
  v_new_body text;
  v_new_id uuid;
begin
  -- Locate live row.
  select id, body_md
    into v_old_id, v_old_body
    from legal_document_versions
   where doc_kind = 'saas_processor_terms'
     and version_label = 'v1-2026-06-01'
   limit 1;

  if v_old_id is null then
    raise notice 'mig 0118: source row v1-2026-06-01 not found — skipping (clean test DB)';
    return;
  end if;

  -- Idempotency.
  perform 1
     from legal_document_versions
    where doc_kind = 'saas_processor_terms'
      and version_label = 'v1-2026-06-09-editorial';
  if found then
    raise notice 'mig 0118: editorial row already present — skipping';
    return;
  end if;

  -- Per-kind advisory lock.
  perform pg_advisory_xact_lock(hashtext('legal:saas_processor_terms'));

  v_new_body := v_old_body;

  -- 1) Email unification.
  v_new_body := replace(v_new_body, 'igotstyle227@gmail.com', 'support@levelchannel.ru');

  -- 2) Court substitution — Челябинская → Смоленская.
  v_new_body := replace(
    v_new_body,
    'Арбитражном суде Челябинской области',
    'Арбитражном суде Смоленской области'
  );

  -- 3) Place of contract — Челябинск → Смоленск (opening + closing headers).
  v_new_body := replace(
    v_new_body,
    'Место заключения договора: г. Челябинск.',
    'Место заключения договора: г. Смоленск.'
  );

  -- 4) Update version stamp (opening + closing — same string in this doc).
  v_new_body := replace(
    v_new_body,
    'Версия v1. Дата редакции: 1 июня 2026 г.',
    'Версия v1, редакция от 1 июня 2026 г. (техническая правка от 9 июня 2026 г.).'
  );

  -- Defensive: at least one substitution must have landed.
  if v_new_body = v_old_body then
    raise exception 'mig 0118: no substitutions matched — source body drift; aborting';
  end if;

  insert into legal_document_versions
    (doc_kind, version_label, effective_from, body_md,
     previous_version_id, created_by_account_id, change_kind)
  values
    ('saas_processor_terms',
     'v1-2026-06-09-editorial',
     now(),
     v_new_body,
     v_old_id,
     null,
     'editorial')
  returning id into v_new_id;

  raise notice 'mig 0118: editorial row % chained to %', v_new_id, v_old_id;
end
$migration$;
