'use client'

/**
 * Client-side analytics SDK.
 *
 * API:
 *   track(name, properties)            — record an event
 *   identify(accountId, userProps?)    — associate session with account
 *   page()                             — fire page_view (auto by TrackingProvider)
 *   reset()                            — flush + rotate anonymous_id (on logout)
 *
 * Transport: in-memory queue + localStorage mirror (crash-survival).
 * Flush every 5s OR 20 events OR `visibilitychange = 'hidden'`.
 * sendBeacon used when available — survives page unload.
 *
 * Cookie management is server-side (POST /api/events sets/rotates lc_aid).
 * Client only READS the cookie via document.cookie (HttpOnly=false).
 */

import type { EventName, EventProperties } from './registry'

const BUFFER_KEY = 'lc_evt_buf'
const SESSION_KEY = 'lc_evt_session'
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 min inactivity
const FLUSH_INTERVAL_MS = 5_000
const FLUSH_BATCH_SIZE = 20
const ENDPOINT = '/api/events'

type QueuedEvent = {
  event_id: string
  event_name: string
  occurred_at: string
  session_id: string
  url: string
  referrer: string | undefined
  properties: Record<string, unknown>
}

type SessionState = {
  session_id: string
  last_seen_ms: number
}

// ─── Internal state ─────────────────────────────────────────────────

let memoryBuffer: QueuedEvent[] = []
let currentAccountId: string | null = null
let currentUserProps: Record<string, unknown> = {}
let flushTimer: ReturnType<typeof setInterval> | null = null
let bootstrapped = false

// ─── Storage helpers (safe — Safari Private may throw) ──────────────

function safeLoadBuffer(): QueuedEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(BUFFER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueuedEvent[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function safeSaveBuffer(buf: QueuedEvent[]): void {
  if (typeof window === 'undefined') return
  try {
    if (buf.length === 0) {
      window.localStorage.removeItem(BUFFER_KEY)
    } else {
      window.localStorage.setItem(BUFFER_KEY, JSON.stringify(buf.slice(-500)))
    }
  } catch {
    // Safari private mode — ignore.
  }
}

function safeLoadSession(): SessionState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SessionState
  } catch {
    return null
  }
}

function safeSaveSession(s: SessionState): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

// ─── UUID v4 helper ────────────────────────────────────────────────

function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback — should never hit in modern browsers.
  return '00000000-0000-4000-8000-000000000000'.replace(/[018]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === '0' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ─── Session management ────────────────────────────────────────────

function getOrCreateSessionId(): string {
  const now = Date.now()
  const existing = safeLoadSession()
  if (existing && now - existing.last_seen_ms < SESSION_TIMEOUT_MS) {
    const updated = { ...existing, last_seen_ms: now }
    safeSaveSession(updated)
    return existing.session_id
  }
  const next: SessionState = { session_id: uuidv4(), last_seen_ms: now }
  safeSaveSession(next)
  return next.session_id
}

// ─── Account identification (cross-tab via storage event) ──────────

function loadAccountId(): void {
  if (typeof window === 'undefined') return
  try {
    const v = window.localStorage.getItem('lc_evt_acc')
    currentAccountId = v && v.length > 0 ? v : null
  } catch {
    // ignore
  }
}

function saveAccountId(accountId: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (accountId) {
      window.localStorage.setItem('lc_evt_acc', accountId)
    } else {
      window.localStorage.removeItem('lc_evt_acc')
    }
  } catch {
    // ignore
  }
}

// ─── Bootstrap (idempotent) ────────────────────────────────────────

function bootstrap(): void {
  if (bootstrapped || typeof window === 'undefined') return
  bootstrapped = true
  memoryBuffer = safeLoadBuffer()
  loadAccountId()

  // Cross-tab account sync.
  window.addEventListener('storage', (e) => {
    if (e.key === 'lc_evt_acc') {
      currentAccountId = e.newValue ?? null
    }
  })

  // Flush every N seconds.
  flushTimer = setInterval(() => {
    if (memoryBuffer.length > 0) flush('timer')
  }, FLUSH_INTERVAL_MS)

  // Flush on hidden — most-reliable signal before unload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && memoryBuffer.length > 0) {
      flush('beacon')
    }
  })

  // Last-ditch flush on pagehide (iOS Safari).
  window.addEventListener('pagehide', () => {
    if (memoryBuffer.length > 0) flush('beacon')
  })
}

// ─── Flush (sendBeacon when possible) ──────────────────────────────

function flush(mode: 'timer' | 'beacon'): void {
  if (typeof window === 'undefined' || memoryBuffer.length === 0) return
  const batch = memoryBuffer.slice(0, FLUSH_BATCH_SIZE)
  memoryBuffer = memoryBuffer.slice(batch.length)
  safeSaveBuffer(memoryBuffer)

  const body = JSON.stringify({
    sent_at: new Date().toISOString(),
    batch,
  })

  if (mode === 'beacon' && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(ENDPOINT, blob)
    } catch {
      // ignore
    }
    return
  }

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
    cache: 'no-store',
    credentials: 'same-origin',
  }).catch(() => {
    // Network failure — re-enqueue batch at HEAD for retry next flush.
    memoryBuffer = [...batch, ...memoryBuffer]
    safeSaveBuffer(memoryBuffer)
  })
}

/** Force flush (used on logout BEFORE rotating anonymous_id). */
export async function forceFlush(): Promise<void> {
  if (typeof window === 'undefined') return
  while (memoryBuffer.length > 0) {
    flush('timer')
    // Give fetch a tick.
    await new Promise((r) => setTimeout(r, 50))
  }
}

// ─── Public API ────────────────────────────────────────────────────

function currentPath(): string {
  if (typeof window === 'undefined') return ''
  return window.location.pathname + window.location.search
}

/**
 * Record an event. Caller MUST use a name from EVENT_REGISTRY — TS enforces
 * this. Properties are type-checked against the registry schema.
 */
export function track<N extends EventName>(name: N, properties?: EventProperties<N>): void {
  if (typeof window === 'undefined') return
  bootstrap()
  const event: QueuedEvent = {
    event_id: uuidv4(),
    event_name: name,
    occurred_at: new Date().toISOString(),
    session_id: getOrCreateSessionId(),
    url: currentPath(),
    referrer: document.referrer || undefined,
    properties: (properties ?? {}) as Record<string, unknown>,
  }
  memoryBuffer.push(event)
  safeSaveBuffer(memoryBuffer)
  if (memoryBuffer.length >= FLUSH_BATCH_SIZE) {
    flush('timer')
  }
}

/**
 * Associate the session with an account. Server-side identify() in
 * /api/auth/{register,login} sets the account_id on existing events
 * via linkAnonymousIdToAccount(). This client call ensures FUTURE
 * events carry account_id directly (no race with server UPDATE).
 */
export function identify(accountId: string, userProps?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  bootstrap()
  currentAccountId = accountId
  currentUserProps = { ...currentUserProps, ...(userProps ?? {}) }
  saveAccountId(accountId)
}

/** Get current account_id (useful for debug/testing). */
export function getCurrentAccountId(): string | null {
  return currentAccountId
}

/** Manually fire page_view (TrackingProvider does this automatically). */
export function page(properties?: { title?: string }): void {
  track('page_view', properties ?? {})
}

/**
 * Logout cleanup: flush all pending events with the current
 * anonymous_id, then forget account_id. Cookie rotation happens
 * server-side on next /api/events POST (or via /api/auth/logout
 * which also clears lc_aid cookie).
 */
export async function reset(): Promise<void> {
  if (typeof window === 'undefined') return
  await forceFlush()
  currentAccountId = null
  currentUserProps = {}
  saveAccountId(null)
}
