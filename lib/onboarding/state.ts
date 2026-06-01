// ONBOARDING wave Sub-PR A foundation — server-side state helpers.
//
// Контракт:
//   - getOnboardingState(accountId) — SELECT-only. Lazy-init: возвращает
//     пустую map если row отсутствует, без INSERT.
//   - dismissOnboardingHint(accountId, key) — UPSERT с key whitelisting.
//     Unknown key → throws (callers конвертят в HTTP 400).
//   - resetOnboardingState(accountId) — UPDATE dismissed_hints = '{}'.
//     Used by admin CLI + по user-action из настроек ("Показать подсказки
//     снова").
//
// ⚠️ NO SCHEMA MUTATION в helpers — никаких CREATE/ALTER. Schema создаётся
//   migrations/0100_account_onboarding_state.sql. Memory pitfall:
//   `postgres_create_table_locks_during_active_tx.md` — DDL внутри транзакции
//   route'а вешает SSR на ACCESS EXCLUSIVE lock.

import { getDbPool } from '@/lib/db/pool'
import { isOnboardingHintKey, type OnboardingHintKey } from './keys'

export type DismissedHints = Partial<Record<OnboardingHintKey, string>>

export type OnboardingState = {
  accountId: string
  dismissedHints: DismissedHints
  updatedAt: string | null
}

/**
 * SELECT-only. Returns empty state when no row exists (lazy-init pattern —
 * INSERT happens только на первом `dismissOnboardingHint`).
 */
export async function getOnboardingState(
  accountId: string,
): Promise<OnboardingState> {
  const pool = getDbPool()
  const result = await pool.query<{
    dismissed_hints: unknown
    updated_at: unknown
  }>(
    `select dismissed_hints, updated_at
       from account_onboarding_state
      where account_id = $1::uuid
      limit 1`,
    [accountId],
  )
  if (result.rows.length === 0) {
    return { accountId, dismissedHints: {}, updatedAt: null }
  }
  const row = result.rows[0]
  return {
    accountId,
    dismissedHints: filterToWhitelist(row.dismissed_hints),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  }
}

/**
 * Помечает hint dismissed для аккаунта. Идемпотентен: повторный dismiss
 * того же ключа просто обновит timestamp.
 *
 * @throws Error если key не в `ONBOARDING_HINT_KEYS` whitelist.
 */
export async function dismissOnboardingHint(
  accountId: string,
  key: string,
): Promise<OnboardingState> {
  if (!isOnboardingHintKey(key)) {
    throw new Error(`unknown onboarding hint key: ${key}`)
  }
  const nowIso = new Date().toISOString()
  const pool = getDbPool()
  const result = await pool.query<{
    dismissed_hints: unknown
    updated_at: unknown
  }>(
    `insert into account_onboarding_state (account_id, dismissed_hints, updated_at)
     values ($1::uuid, jsonb_build_object($2::text, $3::text), now())
     on conflict (account_id) do update
       set dismissed_hints = account_onboarding_state.dismissed_hints
                              || jsonb_build_object($2::text, $3::text),
           updated_at = now()
     returning dismissed_hints, updated_at`,
    [accountId, key, nowIso],
  )
  const row = result.rows[0]
  return {
    accountId,
    dismissedHints: filterToWhitelist(row.dismissed_hints),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }
}

/**
 * Очищает все dismissed-флаги аккаунта. UPDATE-only; не создаёт row если
 * его нет (нечего сбрасывать).
 */
export async function resetOnboardingState(
  accountId: string,
): Promise<OnboardingState> {
  const pool = getDbPool()
  await pool.query(
    `update account_onboarding_state
        set dismissed_hints = '{}'::jsonb,
            updated_at = now()
      where account_id = $1::uuid`,
    [accountId],
  )
  return getOnboardingState(accountId)
}

/**
 * Filters arbitrary JSONB to known whitelist keys. Defensive against
 * legacy rows where an admin manually inserted a key that isn't in the
 * current `ONBOARDING_HINT_KEYS` (e.g. после удаления hint'а в Sub-PR D
 * cleanup): такие ключи становятся «soft-dropped» — невидимы для UI, но
 * остаются в DB пока не пройдёт следующий dismiss/reset.
 */
function filterToWhitelist(raw: unknown): DismissedHints {
  if (!raw || typeof raw !== 'object') return {}
  const out: DismissedHints = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isOnboardingHintKey(k) && typeof v === 'string') {
      out[k] = v
    }
  }
  return out
}
