// BCS-DEF-4-PUSH (2026-06-06) — TS-side audit writer for push.subscription.*
// events emitted from API routes (subscribe/unsubscribe). Wraps
// recordAuthAuditEvent with typed shortcuts that perform the email
// lookup internally.
//
// The 5th event type (push.subscription.unsubscribed.auto) is emitted
// from the .mjs scheduler — see scripts/lib/push-events.mjs.
//
// Plan: docs/plans/bcs-def-4-push-pwa-reminders.md §3.11

import { recordAuthAuditEvent } from '@/lib/audit/auth-events'
import { getAccountById } from '@/lib/auth/accounts'

type Common = {
  accountId: string
  email: string
  clientIp?: string | null
  userAgent?: string | null
  endpoint: string
}

function safeEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname
  } catch {
    return ''
  }
}

export async function recordPushSubscriptionCreated(
  args: Common,
): Promise<void> {
  await recordAuthAuditEvent({
    eventType: 'push.subscription.created',
    accountId: args.accountId,
    email: args.email,
    clientIp: args.clientIp ?? null,
    userAgent: args.userAgent ?? null,
    payload: { endpoint_host: safeEndpointHost(args.endpoint) },
  })
}

export async function recordPushSubscriptionRevived(
  args: Common,
): Promise<void> {
  await recordAuthAuditEvent({
    eventType: 'push.subscription.revived',
    accountId: args.accountId,
    email: args.email,
    clientIp: args.clientIp ?? null,
    userAgent: args.userAgent ?? null,
    payload: { endpoint_host: safeEndpointHost(args.endpoint) },
  })
}

export async function recordPushSubscriptionUnsubscribedUser(
  args: Common,
): Promise<void> {
  await recordAuthAuditEvent({
    eventType: 'push.subscription.unsubscribed.user',
    accountId: args.accountId,
    email: args.email,
    clientIp: args.clientIp ?? null,
    userAgent: args.userAgent ?? null,
    payload: { endpoint_host: safeEndpointHost(args.endpoint) },
  })
}

export async function recordPushSubscriptionReassigned(args: {
  newAccountId: string
  newEmail: string
  oldAccountId: string
  endpoint: string
  clientIp?: string | null
  userAgent?: string | null
}): Promise<void> {
  const oldAccount = await getAccountById(args.oldAccountId).catch(() => null)
  const oldEmail = oldAccount?.email ?? ''
  const endpointHost = safeEndpointHost(args.endpoint)

  await recordAuthAuditEvent({
    eventType: 'push.subscription.reassigned',
    accountId: args.newAccountId,
    email: args.newEmail,
    clientIp: args.clientIp ?? null,
    userAgent: args.userAgent ?? null,
    payload: {
      endpoint_host: endpointHost,
      displaced_account_id: args.oldAccountId,
    },
  })

  await recordAuthAuditEvent({
    eventType: 'push.subscription.unsubscribed.auto',
    accountId: args.oldAccountId,
    email: oldEmail,
    clientIp: null,
    userAgent: null,
    payload: {
      endpoint_host: endpointHost,
      reason: 'reassigned-by-other-account',
    },
  })
}

export async function recordPushSubscriptionCapEvicted(args: {
  accountId: string
  endpoint: string
}): Promise<void> {
  const account = await getAccountById(args.accountId).catch(() => null)
  const email = account?.email ?? ''
  await recordAuthAuditEvent({
    eventType: 'push.subscription.unsubscribed.auto',
    accountId: args.accountId,
    email,
    clientIp: null,
    userAgent: null,
    payload: {
      endpoint_host: safeEndpointHost(args.endpoint),
      reason: 'cap_reached',
    },
  })
}
