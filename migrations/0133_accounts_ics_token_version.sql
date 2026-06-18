-- 0133_accounts_ics_token_version.sql
-- 2026-06-18 codex-audit BLOCKER §5.1 fix.
--
-- Issue (from docs/audit/2026-06-18-codex-quality-design-review.md):
-- Учнический ICS feed (lib/calendar/learner-ics.ts) был бессрочным
-- bearer URL без revoke. Утёкшая ссылка = долгоживущий доступ к
-- расписанию + teacher email. Единственный способ отозвать был —
-- ротация глобального секрета для всех учеников.
--
-- Fix: per-account token-version. HMAC over (accountId | version |
-- expiresAt). Bump version → старые токены автоматически invalid.
-- Учнический UI получает кнопку «Обновить ссылку».

alter table accounts
  add column if not exists ics_token_version int not null default 1;

comment on column accounts.ics_token_version is
  'Per-account version для подписки ICS токена. Bump → ротация только '
  'этого ученика, не глобальный секрет. См. lib/calendar/learner-ics.ts.';
