import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { getAccountProfile } from '@/lib/auth/profiles'
import { listClaimsForTeacher } from '@/lib/payments/sbp-claims'
import { listRefundsForTeacher } from '@/lib/payments/sbp-refunds'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// teacher-payments-sbp-self-service Sub-PR F.
// CSV-выгрузка для самозанятых. UTF-8 + BOM (Excel-friendly).
// Codex round-1 WN-5 fixes:
//   - parse `to=` filter
//   - use teacher timezone for date formatting (not UTC)
//   - stream response, don't build full string in memory

function escapeCsv(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatRub(kopecks: number): string {
  return (kopecks / 100).toFixed(2)
}

function makeDateFormatter(tz: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'teacher:csv:ip', 10, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  // Teacher timezone for date display.
  const profile = await getAccountProfile(guard.account.id).catch(() => null)
  const tz = profile?.timezone || 'Europe/Moscow'
  const fmtDate = makeDateFormatter(tz)

  const url = new URL(request.url)
  const fromStr = url.searchParams.get('from')
  const toStr = url.searchParams.get('to')
  const fromDate = fromStr ? new Date(fromStr) : null
  const toDate = toStr ? new Date(toStr) : null
  if (toDate) {
    // Treat `to` as inclusive end of day in teacher tz: add 1 day for compare.
    toDate.setUTCDate(toDate.getUTCDate() + 1)
  }

  const [claims, refunds] = await Promise.all([
    listClaimsForTeacher(guard.account.id, ['confirmed'], 5000),
    listRefundsForTeacher(guard.account.id, 5000),
  ])

  const inRange = (iso: string): boolean => {
    const d = new Date(iso)
    if (fromDate && d < fromDate) return false
    if (toDate && d >= toDate) return false
    return true
  }

  const filteredClaims = claims.filter((c) =>
    inRange(c.paidAt ?? c.resolvedAt ?? c.claimedAt),
  )
  const filteredRefunds = refunds.filter((r) => inRange(r.refundedAt))
  const claimsById = new Map(filteredClaims.map((c) => [c.id, c]))

  // Stream CSV one row at a time — avoids building 5k-row string in memory.
  const encoder = new TextEncoder()
  const header = [
    'Дата',
    'Тип',
    'Ученик',
    'Сумма (₽)',
    'Способ',
    'Метод',
    'Комментарий',
  ]
    .map(escapeCsv)
    .join(',')

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode('\uFEFF'))
      controller.enqueue(encoder.encode(header + '\n'))
      for (const c of filteredClaims) {
        const date = fmtDate.format(
          new Date(c.paidAt ?? c.resolvedAt ?? c.claimedAt),
        )
        const method =
          c.paymentMethodPhone && c.paymentMethodBank
            ? `${c.paymentMethodPhone} ${c.paymentMethodBank}`
            : ''
        const row = [
          date,
          'Оплата',
          c.learnerName,
          formatRub(c.amountKopecks),
          c.paymentChannel === 'sbp' ? 'СБП' : 'Другой',
          method,
          c.noteTeacher ?? c.noteLearner ?? '',
        ]
          .map(escapeCsv)
          .join(',')
        controller.enqueue(encoder.encode(row + '\n'))
      }
      for (const r of filteredRefunds) {
        const claim = claimsById.get(r.claimId)
        const row = [
          fmtDate.format(new Date(r.refundedAt)),
          'Возврат',
          claim?.learnerName ?? '',
          `-${formatRub(r.amountKopecks)}`,
          '',
          '',
          r.note ?? r.reason,
        ]
          .map(escapeCsv)
          .join(',')
        controller.enqueue(encoder.encode(row + '\n'))
      }
      controller.close()
    },
  })

  const filename = `payments-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
