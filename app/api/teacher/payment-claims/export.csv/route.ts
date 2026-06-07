import { requireTeacherWithCurrentSaasOfferConsent } from '@/lib/auth/guards'
import { listClaimsForTeacher } from '@/lib/payments/sbp-claims'
import { listRefundsForTeacher } from '@/lib/payments/sbp-refunds'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// teacher-payments-sbp-self-service Sub-PR F.
// CSV-выгрузка для самозанятых. UTF-8 + BOM (Excel-friendly).
// Включает confirmed claims за период + refunds.
// Plan: docs/plans/teacher-payments-sbp-self-service.md §3.8

function escapeCsv(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatRub(kopecks: number): string {
  return (kopecks / 100).toFixed(2)
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'teacher:csv:ip', 10, 60_000)
  if (rl) return rl

  const guard = await requireTeacherWithCurrentSaasOfferConsent(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const fromStr = url.searchParams.get('from')
  const fromDate = fromStr ? new Date(fromStr) : null

  const [claims, refunds] = await Promise.all([
    listClaimsForTeacher(guard.account.id, ['confirmed'], 5000),
    listRefundsForTeacher(guard.account.id, 5000),
  ])

  const filteredClaims = claims.filter((c) => {
    if (!fromDate) return true
    const when = new Date(c.paidAt ?? c.resolvedAt ?? c.claimedAt)
    return when >= fromDate
  })
  const filteredRefunds = refunds.filter((r) => {
    if (!fromDate) return true
    return new Date(r.refundedAt) >= fromDate
  })

  const rows: string[] = []
  rows.push(
    ['Дата', 'Тип', 'Ученик', 'Сумма (₽)', 'Способ', 'Метод', 'Комментарий']
      .map(escapeCsv)
      .join(','),
  )
  for (const c of filteredClaims) {
    const date = formatDate(c.paidAt ?? c.resolvedAt ?? c.claimedAt)
    const method =
      c.paymentMethodPhone && c.paymentMethodBank
        ? `${c.paymentMethodPhone} ${c.paymentMethodBank}`
        : ''
    rows.push(
      [
        date,
        'Оплата',
        c.learnerName,
        formatRub(c.amountKopecks),
        c.paymentChannel === 'sbp' ? 'СБП' : 'Другой',
        method,
        c.noteTeacher ?? c.noteLearner ?? '',
      ]
        .map(escapeCsv)
        .join(','),
    )
  }
  // Refunds — отрицательной суммой.
  const claimsById = new Map(filteredClaims.map((c) => [c.id, c]))
  for (const r of filteredRefunds) {
    const claim = claimsById.get(r.claimId)
    rows.push(
      [
        formatDate(r.refundedAt),
        'Возврат',
        claim?.learnerName ?? '',
        `-${formatRub(r.amountKopecks)}`,
        '',
        '',
        r.note ?? r.reason,
      ]
        .map(escapeCsv)
        .join(','),
    )
  }

  const body = '\uFEFF' + rows.join('\n') + '\n'
  const filename = `payments-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
