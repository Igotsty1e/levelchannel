// State-aware Google Calendar integration status derivation for
// learner and teacher cabinet surfaces. Plan: docs/plans/
// cabinet-stale-future-labels.md §A.1 + §A.2.
//
// Single source of truth for rendering "what works right now" copy
// without lying about the user's actual integration state. The two
// axes (pull and push) are independent — push can be broken while
// pull is healthy, and vice versa.
//
// Pull-axis: based on sync_state + last_pulled_at freshness (10 min
// TTL matches the SQL predicate used by booking and hidden-slots).
//
// Push-axis: based on sync_state + write_calendar_id presence. The
// recency of last_push_at is NOT a health predicate — an idle
// integration with no recent bookings is still healthy. This mirrors
// the push-worker gate at lib/calendar/push-worker.ts:481-495.

import type { TeacherCalendarIntegrationRecord } from './integrations'

export type PullStatus =
  | 'no_integration'
  | 'disconnected'
  | 'active_fresh'
  | 'active_stale'
  | 'degraded'

export type PushStatus =
  | 'no_integration'
  | 'disconnected'
  | 'no_write_calendar'
  | 'works'

const PULL_FRESHNESS_TTL_MS = 10 * 60 * 1000

export function derivePullStatus(
  integration: TeacherCalendarIntegrationRecord | null,
  now: Date = new Date(),
): PullStatus {
  if (!integration) return 'no_integration'
  if (integration.syncState === 'disconnected') return 'disconnected'
  if (integration.syncState === 'degraded') return 'degraded'
  // syncState === 'active'
  if (!integration.lastPulledAt) return 'active_stale'
  const lastPulled = new Date(integration.lastPulledAt).getTime()
  const ageMs = now.getTime() - lastPulled
  if (ageMs > PULL_FRESHNESS_TTL_MS) return 'active_stale'
  return 'active_fresh'
}

export function derivePushStatus(
  integration: TeacherCalendarIntegrationRecord | null,
): PushStatus {
  if (!integration) return 'no_integration'
  if (integration.syncState === 'disconnected') return 'disconnected'
  if (!integration.writeCalendarId) return 'no_write_calendar'
  return 'works'
}

export function isCalendarConnected(
  integration: TeacherCalendarIntegrationRecord | null,
): boolean {
  if (!integration) return false
  return (
    integration.syncState === 'active' || integration.syncState === 'degraded'
  )
}
