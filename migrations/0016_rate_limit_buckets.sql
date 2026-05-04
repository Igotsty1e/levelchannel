-- Shared-store rate limit buckets.
--
-- Purpose: replace the in-memory `Map<string, RateLimitBucket>` in
-- `lib/security/rate-limit.ts` with a Postgres-backed bucket so the
-- counter survives across instances. nginx `limit_req` already caps
-- raw request volume; this layer holds the per-route semantics
-- (auth:reset-request 5/min/IP, payments:create 10/min/IP, etc.) and
-- has to agree across replicas once we move past one app process.
--
-- Algorithm (fixed window, matches the previous in-memory semantics):
--   - First hit on a key: insert {count=1, reset_at=now+windowMs}.
--   - Subsequent hit before reset_at: count := count + 1.
--   - Hit at/after reset_at: count := 1, reset_at := now+windowMs.
-- The decision (allow/deny) is taken in app code by comparing the
-- returned count against the limit. Decision is *never* stored —
-- limits are per-route configuration, not bucket state.
--
-- Why count is unbounded above the limit:
-- the bucket increment is monotonic until the window resets. Storing
-- a clamped count would lose the ability to tell "barely over" from
-- "burst attack" in a future audit.
--
-- Cleanup: db-retention-cleanup.mjs deletes rows with reset_at older
-- than 1 hour; the in-app upsert refreshes anything still active.
-- 1h grace covers the longest current window (60s) plus a buffer.

create table if not exists rate_limit_buckets (
  bucket_key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null
);

create index if not exists rate_limit_buckets_reset_at_idx
  on rate_limit_buckets (reset_at);
