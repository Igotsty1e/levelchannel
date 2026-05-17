import { NextResponse } from 'next/server'

import { NO_STORE } from '@/lib/api/http-headers'
import { requireAdminRole } from '@/lib/auth/guards'
import { listAccountsWithPostpaidDebtAggregate } from '@/lib/billing/packages'
import { enforceRateLimit } from '@/lib/security/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Wave 58 — admin debt summary endpoint. Returns a per-account
// aggregate of postpaid debt across the whole learner base. Used by
// the operator UI to spot late payers and (optionally) export the
// summary as CSV for offline follow-up.
//
// Query params:
//   minKopecks  — filter out accounts whose total debt is below the
//                 threshold (defaults to 0; surfaces every account
//                 with any debt slot).
//   format=csv  — emit text/csv with a stable column order suitable
//                 for spreadsheet import. Default is JSON.
//
// Origin gate is NOT applied: this is a GET that doesn't mutate; the
// admin-role guard is the security boundary.

function parseMinKopecks(input: string | null): number {
  if (!input) return 0
  const n = Number(input)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export async function GET(request: Request) {
  const rl = await enforceRateLimit(request, 'admin:debt-summary:ip', 30, 60_000)
  if (rl) return rl

  const guard = await requireAdminRole(request)
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const minKopecks = parseMinKopecks(url.searchParams.get('minKopecks'))
  const format = url.searchParams.get('format') ?? 'json'

  const rows = await listAccountsWithPostpaidDebtAggregate({ minKopecks })

  if (format === 'csv') {
    const header = [
      'account_id',
      'email',
      'display_name',
      'total_debt_kopecks',
      'total_debt_rub',
      'slot_count',
      'slots_without_tariff',
      'oldest_debt_slot_at',
    ].join(',')
    const body = rows
      .map((r) =>
        [
          r.accountId,
          r.email,
          r.displayName ?? '',
          String(r.totalDebtKopecks),
          (r.totalDebtKopecks / 100).toFixed(2),
          String(r.slotCount),
          String(r.slotsWithoutTariff),
          r.oldestDebtSlotAt,
        ]
          .map(escapeCsvCell)
          .join(','),
      )
      .join('\n')
    const csv = header + '\n' + body + (body.length > 0 ? '\n' : '')
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition':
          'attachment; filename="postpaid-debt-summary.csv"',
      },
    })
  }

  return NextResponse.json(
    {
      rows,
      filter: { minKopecks },
      totalAccounts: rows.length,
      totalDebtKopecks: rows.reduce((s, r) => s + r.totalDebtKopecks, 0),
    },
    { status: 200, headers: NO_STORE },
  )
}
