import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import {
  deleteOperatorSetting,
  setOperatorSetting,
  SETTING_SCHEMA,
  type SettingKey,
} from '@/lib/admin/operator-settings'
import { requireAdminRole } from '@/lib/auth/guards'
import {
  enforceRateLimit,
  enforceTrustedBrowserOrigin,
} from '@/lib/security/request'

// ALERTS-EDITOR Sub-PR C (2026-05-18) — POST + DELETE
// /api/admin/settings/alerts/setting/[key].
// Plan: docs/plans/alerts-editor.md §4.4.
//
// POST writes a new value for an editable knob; DELETE clears the
// DB row so the resolver falls through to env/default.
//
// Auth + rate-limit + origin shape mirrors the AUDIT-CODE-1 admin
// mutator pattern (requireAdminRole + enforceRateLimit +
// enforceTrustedBrowserOrigin). NOT wrapped in withIdempotency —
// after the post-merge paranoia rollback withIdempotency is
// sequential-only and cannot defend concurrent edits. Optimistic
// concurrency via expectedUpdatedAt is the correct guard here.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ key: string }> }

function statusForReason(
  reason:
    | 'unknown_key'
    | 'invalid_value'
    | 'concurrent_update'
    | 'migration_pending',
): number {
  switch (reason) {
    case 'unknown_key':
    case 'invalid_value':
      return 400
    case 'concurrent_update':
      return 409
    case 'migration_pending':
      return 503
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:operator-settings:write:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const auth = await requireAdminRole(request)
  if (!auth.ok) return auth.response

  const { key } = await params
  if (!(key in SETTING_SCHEMA)) {
    return NextResponse.json(
      { error: 'unknown_key' },
      { status: 400, headers: NO_STORE },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  const raw = body as Record<string, unknown>
  if (typeof raw.value !== 'string') {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  const expectedUpdatedAt =
    raw.expectedUpdatedAt === null || raw.expectedUpdatedAt === undefined
      ? null
      : typeof raw.expectedUpdatedAt === 'string'
        ? raw.expectedUpdatedAt
        : undefined
  if (expectedUpdatedAt === undefined) {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await setOperatorSetting({
    key: key as SettingKey,
    value: raw.value,
    expectedUpdatedAt,
    byAccountId: auth.account.id,
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: statusForReason(result.reason), headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { ok: true, updatedAt: result.updatedAt },
    { headers: NO_STORE },
  )
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const rl = await enforceRateLimit(
    request,
    'admin:operator-settings:write:ip',
    30,
    60_000,
  )
  if (rl) return rl

  const auth = await requireAdminRole(request)
  if (!auth.ok) return auth.response

  const { key } = await params
  if (!(key in SETTING_SCHEMA)) {
    return NextResponse.json(
      { error: 'unknown_key' },
      { status: 400, headers: NO_STORE },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }
  const raw = body as Record<string, unknown>
  if (typeof raw.expectedUpdatedAt !== 'string') {
    return NextResponse.json(
      { error: 'invalid_body' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await deleteOperatorSetting({
    key: key as SettingKey,
    expectedUpdatedAt: raw.expectedUpdatedAt,
    byAccountId: auth.account.id,
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: statusForReason(result.reason), headers: NO_STORE },
    )
  }
  return NextResponse.json(
    { ok: true, updatedAt: result.updatedAt },
    { headers: NO_STORE },
  )
}
