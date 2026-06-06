import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { resolveOperatorSetting } from '@/lib/admin/operator-settings'

// BCS-DEF-4-PUSH (2026-06-06) — public endpoint returning the VAPID
// public key as text/plain. The browser uses this to call
// `registration.pushManager.subscribe({applicationServerKey: <decoded>})`.
//
// Fail-closed contour:
//   - Master switch off (DB-row → env → default; OR DB blip) → 503 push_disabled.
//   - Any VAPID env triple component missing → 503 vapid_unconfigured.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.8

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const setting = await resolveOperatorSetting(
    'LEARNER_REMINDERS_PUSH_ENABLED',
  )
  if (setting.dbErrored || setting.value !== 1) {
    return NextResponse.json(
      { error: 'push_disabled' },
      { status: 503, headers: NO_STORE },
    )
  }
  const publicKey = (process.env.PUSH_VAPID_PUBLIC_KEY ?? '').trim()
  const privateKey = (process.env.PUSH_VAPID_PRIVATE_KEY ?? '').trim()
  const subject = (process.env.PUSH_VAPID_SUBJECT ?? '').trim()
  if (!publicKey || !privateKey || !subject) {
    return NextResponse.json(
      { error: 'vapid_unconfigured' },
      { status: 503, headers: NO_STORE },
    )
  }
  return new NextResponse(publicKey, {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
