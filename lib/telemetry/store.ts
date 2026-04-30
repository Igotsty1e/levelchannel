import { createHmac } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

import { paymentConfig } from '@/lib/payments/config'
import {
  ensureTelemetrySchemaPostgres,
  insertTelemetryEventPostgres,
} from '@/lib/telemetry/store-postgres'

export type CheckoutTelemetryEvent = {
  at: string
  type: string
  invoiceId?: string
  amountRub?: number
  emailDomain?: string
  emailHash?: string
  emailValid?: boolean
  reason?: string
  message?: string
  path?: string
  userAgent?: string
  ip?: string
}

let writeQueue = Promise.resolve()
let hasWarnedAboutMissingTelemetrySecret = false

function getTelemetryPath() {
  return path.join(process.cwd(), 'data', 'payment-telemetry.jsonl')
}

function getTelemetryHashSecret() {
  const secret = process.env.TELEMETRY_HASH_SECRET?.trim()
  if (secret) return secret

  if (!hasWarnedAboutMissingTelemetrySecret) {
    console.warn(
      'telemetry: TELEMETRY_HASH_SECRET is empty; emailHash will be omitted until it is configured',
    )
    hasWarnedAboutMissingTelemetrySecret = true
  }
  return null
}

function hashEmail(email: string) {
  const secret = getTelemetryHashSecret()
  if (!secret) return undefined

  return createHmac('sha256', secret).update(email).digest('hex')
}

function getEmailDomain(email: string) {
  const parts = email.split('@')
  return parts.length === 2 ? parts[1] : undefined
}

function maskIp(ip: string | undefined) {
  if (!ip) {
    return undefined
  }

  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean)
    return parts.length >= 4 ? `${parts.slice(0, 4).join(':')}::*` : 'ipv6'
  }

  const parts = ip.split('.')
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : undefined
}

function summarizeUserAgent(userAgent: string | undefined) {
  if (!userAgent) {
    return undefined
  }

  const browser = /Edg\//.test(userAgent)
    ? 'edge'
    : /Chrome\//.test(userAgent)
      ? 'chrome'
      : /Firefox\//.test(userAgent)
        ? 'firefox'
        : /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)
          ? 'safari'
          : 'other'

  const device = /Mobile|Android|iPhone/i.test(userAgent) ? 'mobile' : 'desktop'
  return `${browser}:${device}`
}

async function ensureTelemetryFile() {
  const filePath = getTelemetryPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, '', 'utf8')
  }

  return filePath
}

async function withWriteLock<T>(fn: () => Promise<T>) {
  const run = writeQueue.then(fn, fn)
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function appendToFile(event: CheckoutTelemetryEvent) {
  const filePath = await ensureTelemetryFile()
  await withWriteLock(async () => {
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')
  })
}

export function buildCheckoutTelemetryEvent(
  event: Omit<CheckoutTelemetryEvent, 'at' | 'emailHash' | 'emailDomain'> & {
    email?: string
  },
): CheckoutTelemetryEvent {
  const email = event.email?.trim().toLowerCase()

  return {
    at: new Date().toISOString(),
    type: event.type,
    invoiceId: event.invoiceId,
    amountRub: event.amountRub,
    emailValid: event.emailValid,
    reason: event.reason,
    message: event.message,
    path: event.path,
    userAgent: summarizeUserAgent(event.userAgent),
    ip: maskIp(event.ip),
    emailHash: email ? hashEmail(email) : undefined,
    emailDomain: email ? getEmailDomain(email) : undefined,
  }
}

export async function appendCheckoutTelemetryEvent(
  event: Omit<CheckoutTelemetryEvent, 'at' | 'emailHash' | 'emailDomain'> & {
    email?: string
  },
) {
  const normalized = buildCheckoutTelemetryEvent(event)

  // Postgres backend — основной путь для multi-instance деплоя.
  // Если запись падает (DB вне доступа), скатываемся на файловый append,
  // чтобы не терять события и не ронять checkout flow.
  if (paymentConfig.storageBackend === 'postgres') {
    try {
      await ensureTelemetrySchemaPostgres()
      await insertTelemetryEventPostgres(normalized)
      return
    } catch (error) {
      console.warn(
        'telemetry: postgres insert failed, falling back to file',
        error instanceof Error ? error.message : error,
      )
    }
  }

  await appendToFile(normalized)
}
