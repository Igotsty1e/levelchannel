import { describe, expect, it } from 'vitest'

import { decideCancelReenqueue } from '@/lib/calendar/reconcile-runner'

// BCS-G.1 F9‴ gate — pure logic. The integration suite covers the
// full DB + token-refresh + events.get pipeline; this file pins the
// branch table on its own so a regression is obvious from the test
// name.

const NOW = new Date('2026-05-14T08:00:00Z').getTime()
const HOURS_AGO = (h: number) =>
  new Date(NOW - h * 60 * 60_000).toISOString()

describe('decideCancelReenqueue', () => {
  it('enqueues when no prior delete job exists', () => {
    expect(
      decideCancelReenqueue({
        latestJob: null,
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: true })
  })

  it('skips when the latest job is pending (worker is on it)', () => {
    expect(
      decideCancelReenqueue({
        latestJob: { status: 'pending', lastAttemptAt: HOURS_AGO(0.1) },
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: false, reason: 'inflight' })
  })

  it('skips when the latest job is in_progress', () => {
    expect(
      decideCancelReenqueue({
        latestJob: { status: 'in_progress', lastAttemptAt: HOURS_AGO(0.1) },
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: false, reason: 'inflight' })
  })

  it('enqueues a fresh job when the latest job was cancelled_by_dependent', () => {
    expect(
      decideCancelReenqueue({
        latestJob: {
          status: 'cancelled_by_dependent',
          lastAttemptAt: HOURS_AGO(1),
        },
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: true })
  })

  it('skips when the latest succeeded job is younger than the 6h window', () => {
    expect(
      decideCancelReenqueue({
        latestJob: { status: 'succeeded', lastAttemptAt: HOURS_AGO(3) },
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: false, reason: 'recent_success' })
  })

  it('re-enqueues when the latest succeeded job is older than the 6h window', () => {
    expect(
      decideCancelReenqueue({
        latestJob: { status: 'succeeded', lastAttemptAt: HOURS_AGO(7) },
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: true })
  })

  it('enqueues when the latest succeeded job has no last_attempt_at (defensive)', () => {
    expect(
      decideCancelReenqueue({
        latestJob: { status: 'succeeded', lastAttemptAt: null },
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: true })
  })

  it('skips terminal_failure without a fresher last_reconnected_at', () => {
    expect(
      decideCancelReenqueue({
        latestJob: {
          status: 'terminal_failure',
          lastAttemptAt: HOURS_AGO(2),
        },
        lastReconnectedAt: HOURS_AGO(10),
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: false, reason: 'terminal_no_env_change' })
  })

  it('skips terminal_failure when last_reconnected_at is null entirely', () => {
    expect(
      decideCancelReenqueue({
        latestJob: {
          status: 'terminal_failure',
          lastAttemptAt: HOURS_AGO(2),
        },
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: false, reason: 'terminal_no_env_change' })
  })

  it('re-enqueues terminal_failure when integration was reconnected after the prior attempt', () => {
    expect(
      decideCancelReenqueue({
        latestJob: {
          status: 'terminal_failure',
          lastAttemptAt: HOURS_AGO(10),
        },
        lastReconnectedAt: HOURS_AGO(1),
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: true })
  })

  it('enqueues terminal_failure with no last_attempt_at (defensive)', () => {
    expect(
      decideCancelReenqueue({
        latestJob: { status: 'terminal_failure', lastAttemptAt: null },
        lastReconnectedAt: HOURS_AGO(2),
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: true })
  })

  it('skips on an unknown future status (conservative)', () => {
    expect(
      decideCancelReenqueue({
        latestJob: {
          status: 'mystery_state' as never,
          lastAttemptAt: HOURS_AGO(1),
        },
        lastReconnectedAt: null,
        nowMs: NOW,
      }),
    ).toEqual({ enqueue: false, reason: 'inflight' })
  })
})
