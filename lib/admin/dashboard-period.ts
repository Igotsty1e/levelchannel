// Admin dashboard period parser.
// Plan: docs/plans/admin-dashboard.md §Period filter.

export type PeriodKey = '1d' | '7d' | '30d' | 'all'

const ALL_PERIODS: ReadonlyArray<PeriodKey> = ['1d', '7d', '30d', 'all']

export const DEFAULT_PERIOD: PeriodKey = '7d'

export type PeriodWindow = {
  key: PeriodKey
  /** Metric totals window: [currentStart, currentEnd). For `'all'` =
   *  epoch → now (true totals). */
  currentStart: Date
  currentEnd: Date
  previousStart: Date | null
  previousEnd: Date | null
  /** Bucket-rendering window: [bucketRangeStart, currentEnd). For
   *  `'all'` capped at `bucketCount × step` (≈ 6 months) so the
   *  dynamics chart doesn't try to render ~2900 weekly buckets from
   *  epoch. Equals `currentStart` for non-`'all'` periods. */
  bucketRangeStart: Date
  bucketIntervalSql: string
  bucketCount: number
  showDelta: boolean
}

/** Parses raw URL param. Returns fallback (`'7d'`) for unknown values. */
export function parsePeriodOrDefault(raw: string | null | undefined): PeriodKey {
  if (!raw) return DEFAULT_PERIOD
  if ((ALL_PERIODS as ReadonlyArray<string>).includes(raw)) return raw as PeriodKey
  return DEFAULT_PERIOD
}

/**
 * Builds rolling time-window tuple for SQL queries.
 * `currentEnd` = now. `currentStart` = now - period.
 * `previousStart` / `previousEnd` = the period before (for delta);
 * null when `key === 'all'` (no prior period exists).
 */
export function buildPeriodWindow(key: PeriodKey, now: Date = new Date()): PeriodWindow {
  if (key === '1d') {
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const prevEnd = start
    const prevStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    return {
      key,
      currentStart: start,
      currentEnd: now,
      previousStart: prevStart,
      previousEnd: prevEnd,
      bucketRangeStart: start,
      bucketIntervalSql: '1 hour',
      bucketCount: 24,
      showDelta: true,
    }
  }
  if (key === '7d') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const prevEnd = start
    const prevStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    return {
      key,
      currentStart: start,
      currentEnd: now,
      previousStart: prevStart,
      previousEnd: prevEnd,
      bucketRangeStart: start,
      bucketIntervalSql: '1 day',
      bucketCount: 7,
      showDelta: true,
    }
  }
  if (key === '30d') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const prevEnd = start
    const prevStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    return {
      key,
      currentStart: start,
      currentEnd: now,
      previousStart: prevStart,
      previousEnd: prevEnd,
      bucketRangeStart: start,
      bucketIntervalSql: '1 day',
      bucketCount: 30,
      showDelta: true,
    }
  }
  // 'all' — totals from epoch; buckets capped at ~6 months so the
  // dynamics chart doesn't render thousands of empty weekly bars.
  const ALL_BUCKET_COUNT = 26
  const ALL_BUCKET_STEP_MS = 7 * 24 * 60 * 60 * 1000
  return {
    key,
    currentStart: new Date(0),
    currentEnd: now,
    previousStart: null,
    previousEnd: null,
    bucketRangeStart: new Date(now.getTime() - ALL_BUCKET_COUNT * ALL_BUCKET_STEP_MS),
    bucketIntervalSql: '7 days',
    bucketCount: ALL_BUCKET_COUNT,
    showDelta: false,
  }
}

/**
 * Formats delta percentage. Returns `'—'` when prev is null or 0 (avoid
 * division-by-zero / Infinity displays).
 */
export function formatDelta(current: number, previous: number | null): string {
  if (previous === null || previous === 0) return '—'
  const pct = ((current - previous) / previous) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${Math.round(pct)}%`
}
