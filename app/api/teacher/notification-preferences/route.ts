// Epic D — notification preferences GET + PATCH route.
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic D.
//
// GET /api/teacher/notification-preferences
//   → { preferences: { eventKind, channel, enabled }[] }
// PATCH /api/teacher/notification-preferences
//   Body: { updates: { eventKind, channel, enabled }[] }
//   → 200 { ok: true }
//
// Auth: requireTeacherWithCurrentSaasOfferConsent.
// Rate-limit: 30/час/account.
// Validation: eventKind должен быть из NOTIFICATION_EVENT_CATALOG; channel
// ∈ {email,telegram,push}; enabled boolean.

import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { readJsonObjectOr400 } from '@/lib/api/json-body'
import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import {
  NOTIFICATION_CHANNELS_UI,
  NOTIFICATION_EVENT_CATALOG,
  type NotificationChannel,
} from '@/lib/notifications/catalog'
import {
  listNotificationPreferences,
  upsertNotificationPreference,
} from '@/lib/notifications/preferences'
import { enforceAccountRateLimit } from '@/lib/security/account-rate-limit'
import { enforceTrustedBrowserOrigin } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_EVENT_KINDS = new Set(
  NOTIFICATION_EVENT_CATALOG.flatMap((g) => g.items.map((i) => i.kind)),
)
const VALID_CHANNELS = new Set(NOTIFICATION_CHANNELS_UI.map((c) => c.channel))

export async function GET(request: Request) {
  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const preferences = await listNotificationPreferences(guard.account.id)
  return NextResponse.json({ preferences }, { headers: NO_STORE })
}

export async function PATCH(request: Request) {
  const originGate = enforceTrustedBrowserOrigin(request)
  if (originGate) return originGate

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const rl = await enforceAccountRateLimit(
    guard.account.id,
    'teacher:notification-prefs',
    30,
    60 * 60 * 1000,
  )
  if (rl) return rl

  const parsed = await readJsonObjectOr400(request, { coded: true })
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  if (!Array.isArray(body.updates)) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: 'Поле updates должно быть массивом.',
      },
      { status: 400, headers: NO_STORE },
    )
  }
  if (body.updates.length > 200) {
    return NextResponse.json(
      {
        error: 'too_many_updates',
        message: 'Максимум 200 изменений за раз.',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  for (const update of body.updates as Array<unknown>) {
    if (!update || typeof update !== 'object') {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Каждый update — объект.' },
        { status: 400, headers: NO_STORE },
      )
    }
    const u = update as {
      eventKind?: unknown
      channel?: unknown
      enabled?: unknown
    }
    if (
      typeof u.eventKind !== 'string' ||
      !VALID_EVENT_KINDS.has(u.eventKind)
    ) {
      return NextResponse.json(
        { error: 'invalid_event_kind', message: `Неизвестное событие: ${String(u.eventKind)}` },
        { status: 400, headers: NO_STORE },
      )
    }
    if (
      typeof u.channel !== 'string' ||
      !VALID_CHANNELS.has(u.channel as NotificationChannel)
    ) {
      return NextResponse.json(
        { error: 'invalid_channel' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (typeof u.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'invalid_enabled', message: 'enabled должен быть boolean.' },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  // Sequential upserts — список short (≤200), serialized для простоты.
  for (const update of body.updates as Array<{
    eventKind: string
    channel: NotificationChannel
    enabled: boolean
  }>) {
    await upsertNotificationPreference(
      guard.account.id,
      update.eventKind,
      update.channel,
      update.enabled,
    )
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
