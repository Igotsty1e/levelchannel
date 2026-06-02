import { describe, expect, it } from 'vitest'

import {
  derivePullStatus,
  derivePushStatus,
  isCalendarConnected,
} from '@/lib/calendar/derive-status'
import type { TeacherCalendarIntegrationRecord } from '@/lib/calendar/integrations'

const now = new Date('2026-06-02T12:00:00Z')

function record(
  overrides: Partial<TeacherCalendarIntegrationRecord> = {},
): TeacherCalendarIntegrationRecord {
  return {
    accountId: '11111111-1111-1111-1111-111111111111',
    provider: 'google',
    syncState: 'active',
    epoch: '1',
    scope: null,
    tokenExpiresAt: null,
    readCalendarIds: [],
    writeCalendarId: 'primary',
    lastPulledAt: now.toISOString(),
    lastPushAt: null,
    lastReconnectedAt: null,
    lastError: null,
    channelId: null,
    channelResourceId: null,
    channelExpiresAt: null,
    channelToken: null,
    lastSeenMessageNumber: null,
    nextSyncToken: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  }
}

describe('derivePullStatus', () => {
  it('returns no_integration when record is null', () => {
    expect(derivePullStatus(null, now)).toBe('no_integration')
  })

  it('returns disconnected when sync_state is disconnected', () => {
    expect(derivePullStatus(record({ syncState: 'disconnected' }), now)).toBe(
      'disconnected',
    )
  })

  it('returns degraded when sync_state is degraded', () => {
    expect(derivePullStatus(record({ syncState: 'degraded' }), now)).toBe(
      'degraded',
    )
  })

  it('returns active_fresh when last_pulled_at is within 10 min', () => {
    const lastPulled = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    expect(derivePullStatus(record({ lastPulledAt: lastPulled }), now)).toBe(
      'active_fresh',
    )
  })

  it('returns active_stale when last_pulled_at is older than 10 min', () => {
    const lastPulled = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
    expect(derivePullStatus(record({ lastPulledAt: lastPulled }), now)).toBe(
      'active_stale',
    )
  })

  it('returns active_stale when last_pulled_at is null on active integration', () => {
    expect(derivePullStatus(record({ lastPulledAt: null }), now)).toBe(
      'active_stale',
    )
  })

  it('returns active_stale when last_pulled_at is unparseable (NaN guard)', () => {
    expect(
      derivePullStatus(record({ lastPulledAt: 'not-a-date' }), now),
    ).toBe('active_stale')
  })
})

describe('derivePushStatus', () => {
  it('returns no_integration when record is null', () => {
    expect(derivePushStatus(null)).toBe('no_integration')
  })

  it('returns disconnected when sync_state is disconnected', () => {
    expect(derivePushStatus(record({ syncState: 'disconnected' }))).toBe(
      'disconnected',
    )
  })

  it('returns no_write_calendar when write_calendar_id is null on active', () => {
    expect(
      derivePushStatus(record({ syncState: 'active', writeCalendarId: null })),
    ).toBe('no_write_calendar')
  })

  it('returns no_write_calendar when write_calendar_id is null on degraded', () => {
    expect(
      derivePushStatus(
        record({ syncState: 'degraded', writeCalendarId: null }),
      ),
    ).toBe('no_write_calendar')
  })

  it('returns works when sync_state is active + write_calendar_id present', () => {
    expect(
      derivePushStatus(
        record({ syncState: 'active', writeCalendarId: 'primary' }),
      ),
    ).toBe('works')
  })

  it('returns works when sync_state is degraded + write_calendar_id present', () => {
    expect(
      derivePushStatus(
        record({ syncState: 'degraded', writeCalendarId: 'primary' }),
      ),
    ).toBe('works')
  })
})

describe('isCalendarConnected', () => {
  it('returns false for null', () => {
    expect(isCalendarConnected(null)).toBe(false)
  })
  it('returns false for disconnected', () => {
    expect(isCalendarConnected(record({ syncState: 'disconnected' }))).toBe(
      false,
    )
  })
  it('returns true for active', () => {
    expect(isCalendarConnected(record({ syncState: 'active' }))).toBe(true)
  })
  it('returns true for degraded', () => {
    expect(isCalendarConnected(record({ syncState: 'degraded' }))).toBe(true)
  })
})
