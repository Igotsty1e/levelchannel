-- ALERTS-OBS — operator observability for systemd cron alert probes.
--
-- Plan: docs/plans/alerts-obs.md (3-round paranoia loop + manual
-- fresh-eyes pass, 2026-05-16).
--
-- Three probes (auth-flow, calendar-pathology, webhook-flow) today
-- emit JSON to journald and (for two of three) maintain local dedup
-- state files. Operator has no /admin signal that the probes ran or
-- decided anything. This table is the unified observability sink:
-- every probe tick writes one row, every probe alert sets
-- alert_sent=true, every operator-triggered test-send writes a row
-- with is_test=true.
--
-- The plan's §4.4 stats blob carries `stats.thresholds` snapshot per
-- tick, so the /admin/settings/alerts page reads ACTUAL probe-time
-- env values from the row, NOT from the Next.js process env (which
-- is stale until restart).

create table if not exists probe_runs (
  id uuid primary key default gen_random_uuid(),
  probe_name text not null check (probe_name in (
    'auth-flow', 'calendar-pathology', 'webhook-flow'
  )),
  ran_at timestamptz not null default now(),
  verdict_kind text not null check (verdict_kind in (
    'alert_sent',           -- any probe: alert verdict + email sent successfully
    'alert_send_failed',    -- any probe: alert verdict + Resend returned error
    'dedup_skip',           -- any probe: same offender set inside dedup window
    'no_failures',          -- auth-flow: totalFailed == 0
    'within_thresholds',    -- auth-flow: failures but none over threshold ('ok' kind)
    'no_offenders',         -- calendar-pathology: empty offenders list
    'low_volume_skip',      -- webhook-flow: created < MIN_VOLUME
    'all_resolved',         -- webhook-flow: terminated + cancelled >= created
    'ok',                   -- webhook-flow: ratio above floor; healthy
    'config_missing',       -- any probe: ALERT_EMAIL_TO / RESEND_API_KEY unset on alert run
    'error',                -- any probe: unexpected exception (top-level catch)
    'test_send_succeeded',  -- POST /api/admin/settings/alerts/[probe]/test-send happy path
    'test_send_failed'      -- POST /api/admin/settings/alerts/[probe]/test-send error path
  )),
  alert_sent boolean not null default false,
  recipient_email text null,
  alert_email_id text null,
  fingerprint text null,
  stats jsonb null,
  error_message text null,
  is_test boolean not null default false,
  -- on delete restrict matches sibling operator-action audit tables
  -- (payment_refund_attempts.granted_by, package_grant_resolutions).
  -- Audit provenance must survive operator-account anonymization.
  initiator_account_id uuid null references accounts(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Latest run per probe (excludes test-sends).
create index if not exists probe_runs_real_runs_idx
  on probe_runs (probe_name, ran_at desc)
  where is_test = false;

-- Latest real alert per probe (excludes test-sends and non-alert runs).
create index if not exists probe_runs_real_alerts_idx
  on probe_runs (probe_name, ran_at desc)
  where alert_sent = true and is_test = false;

comment on table probe_runs is
  'ALERTS-OBS (2026-05-16): per-tick log of systemd alert probes '
  '(auth-flow, calendar-pathology, webhook-flow). Latest row per '
  '(probe_name, is_test=false) is "last run"; latest row per '
  '(probe_name, alert_sent=true, is_test=false) is "last alert". '
  'is_test=true rows from /api/admin/settings/alerts/[probe]/test-send '
  'are excluded from both queries.';
comment on column probe_runs.recipient_email is
  'Snapshot of ALERT_EMAIL_TO at send time. Persisting here so a '
  'later rotation of the env var does not rewrite history.';
comment on column probe_runs.stats is
  'Per-probe verdict stats AND thresholds snapshot. Admin page reads '
  'thresholds from stats.thresholds (not process.env) to show what '
  'was in effect on the probe tick, not what the long-lived Next.js '
  'process happens to remember.';
