-- mig 0115 — editorial redaction of saas_offer v1-2026-06-01.
--
-- See mig 0116 for the change_kind schema extension that lets the
-- accept-gate auto-pass already-consented teachers through editorial
-- rows.
--
-- Closes 2026-06-08 walkthrough bug #32: body_md was carrying the
-- internal redaction stamp «Версия v2. Дата редакции: 1 июня 2026 г.»
-- while the system label was v1-2026-06-01, causing a hard mismatch
-- on /saas-offer-accept (teachers see two contradictory version
-- markers in the same document).
--
-- Legal contract (research-pack 2026-06-08):
--   - This is a NON-MATERIAL editorial correction. We remove the
--     redaction stamp and a metacomment block («> v2-отличия от v1»);
--     no numbered section of the offer changes. The factual content
--     of the tariff list (раздел 3) is identical (Free / Mid / Pro —
--     no Operator-managed in either version).
--   - 30-day notify per преамбула is NOT triggered (applies only to
--     material changes per ст. 450 ГК + Pleam ВС № 49).
--   - APPEND-ONLY: we DO NOT mutate the existing row v1-2026-06-01.
--     A new chained row is created with previous_version_id pointing
--     to the old one. Existing consent-rows remain anchored to the
--     old row (FK by id) — no party loses audit trail for what they
--     accepted.
--   - getCurrentLegalVersion('saas_offer') will start returning the
--     new row because effective_from = now() is the most recent.
--
-- Idempotent: if a row with the new label already exists, the
-- migration is a no-op.

do $migration$
declare
  v_old_id uuid;
  v_old_body text;
  v_new_body text;
  v_new_id uuid;
  v_changes_count int;
begin
  -- Locate the existing live v1 row. If absent (fresh test DB), skip
  -- silently — the integration setup re-seeds a placeholder which
  -- doesn't carry the typo, so the correction is a no-op there.
  select id, body_md
    into v_old_id, v_old_body
    from legal_document_versions
   where doc_kind = 'saas_offer'
     and version_label = 'v1-2026-06-01'
   limit 1;

  if v_old_id is null then
    raise notice 'mig 0115: source row v1-2026-06-01 not found — skipping (clean test DB)';
    return;
  end if;

  -- Skip if the chained correction row already exists.
  perform 1
     from legal_document_versions
    where doc_kind = 'saas_offer'
      and version_label = 'v1-2026-06-08-editorial';
  if found then
    raise notice 'mig 0115: editorial row already present — skipping';
    return;
  end if;

  -- Per-kind advisory lock — mirrors createLegalVersion (lib/legal/
  -- versions.ts). Held until commit.
  perform pg_advisory_xact_lock(hashtext('legal:saas_offer'));

  -- ----- Editorial substitutions -----
  --
  -- 1) Replace the «Версия v2…» redaction stamp with a neutral
  --    «Версия v1 (редакция 2026-06-01, тех. правка 2026-06-08)…»
  --    line. The legal effect of the line is unchanged — it is a
  --    metadata header, not a numbered condition.
  v_new_body := replace(
    v_old_body,
    'Версия v2. Дата редакции: 1 июня 2026 г. Применимое право: Российская Федерация. Место заключения договора: г. Челябинск.',
    'Версия v1, редакция от 1 июня 2026 г. (техническая правка от 8 июня 2026 г.). Применимое право: Российская Федерация. Место заключения договора: г. Челябинск.'
  );

  -- 2) Remove the «> v2-отличия от v1…» blockquote in its entirety.
  --    This was an internal redaction note, not a contract clause.
  --    Operator-managed remains absent from раздел 3 «Тарифы», so the
  --    underlying factual claim survives via the actual tariff list.
  v_new_body := regexp_replace(
    v_new_body,
    E'> v2-отличия от v1: тариф Operator-managed[\\s\\S]*?блок CHANGES_FROM_V1 в конце документа\\.\\s*',
    '',
    'g'
  );

  -- 3) Closing stamp «Конец оферты, версия v2.» → «Конец оферты, версия v1.»
  v_new_body := replace(
    v_new_body,
    'Конец оферты, версия v2.',
    'Конец оферты, версия v1.'
  );

  -- Defensive: at least one substitution must have landed; if none
  -- did, the source has drifted in an unexpected way and we should
  -- fail loudly rather than silently insert a copy.
  if v_new_body = v_old_body then
    raise exception 'mig 0115: editorial substitutions matched nothing — body shape changed since 2026-06-08; aborting';
  end if;

  insert into legal_document_versions
    (doc_kind, version_label, effective_from, body_md,
     previous_version_id, created_by_account_id)
  values
    ('saas_offer',
     'v1-2026-06-08-editorial',
     now(),
     v_new_body,
     v_old_id,
     null)
  returning id into v_new_id;

  raise notice 'mig 0115: editorial row % chained to old row %', v_new_id, v_old_id;
end
$migration$;
