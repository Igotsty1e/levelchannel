-- bcs-def-1-fanout impl (plan §0b Closure #3 + §0c).
--
-- Distinguish operator email rows from per-teacher email rows in
-- probe_runs. The fan-out scheduler writes N+1 rows per tick when
-- enabled: ONE 'operator' + N 'teacher'. getProbeStatus filters to
-- 'operator' OR NULL (legacy compat) so admin /admin/settings/alerts
-- "Последнее уведомление" pill keeps showing operator-branch outcomes
-- even when teacher-branch sends succeed/fail independently.
--
-- Additive column. NULL acceptable for pre-mig rows (operator-only
-- MVP era) and for probes that never fan out. The fan-out probe MUST
-- set this at insert time per Sub-PR impl checklist.

alter table probe_runs
  add column if not exists alert_audience text null
    check (
      alert_audience is null
      or alert_audience in ('operator', 'teacher')
    );

-- Partial index on (probe_name, alert_audience, ran_at desc) — drives
-- the audience-filtered getProbeStatus query. WHERE clause keeps the
-- index small (pre-mig legacy rows + non-fan-out probes excluded).
create index if not exists probe_runs_probe_audience_ran_idx
  on probe_runs (probe_name, alert_audience, ran_at desc)
  where alert_audience is not null;

comment on column probe_runs.alert_audience is
  'NULL for legacy/non-fan-out rows; ''operator'' for the canonical operator email row; ''teacher'' for per-teacher rows written by fan-out probes (bcs-def-1-fanout)';
