import { createHmac } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

type CheckoutTelemetryEvent = {
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

function getTelemetryPath() {
  return path.join(process.cwd(), 'data', 'payment-telemetry.jsonl')
}

function hashEmail(email: string) {
  const secret =
    process.env.TELEMETRY_HASH_SECRET ||
    process.env.CLOUDPAYMENTS_API_SECRET ||
    'levelchannel-telemetry'

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

export async function appendCheckoutTelemetryEvent(
  event: Omit<CheckoutTelemetryEvent, 'at' | 'emailHash' | 'emailDomain'> & {
    email?: string
  },
) {
  const filePath = await ensureTelemetryFile()
  const email = event.email?.trim().toLowerCase()

  const normalized: CheckoutTelemetryEvent = {
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

  await withWriteLock(async () => {
    await fs.appendFile(filePath, `${JSON.stringify(normalized)}\n`, 'utf8')
  })
}
