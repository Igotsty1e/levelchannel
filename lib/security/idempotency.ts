import { createHash } from 'crypto'

import { NextResponse } from 'next/server'

import { paymentConfig } from '@/lib/payments/config'
import {
  ensureIdempotencySchemaPostgres,
  getIdempotencyRecordPostgres,
  saveIdempotencyRecordPostgres,
} from '@/lib/security/idempotency-postgres'

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/

export type IdempotencyOutcome = {
  status: number
  body: unknown
}

function sha256Hex(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function jsonResponse(outcome: IdempotencyOutcome, replay: boolean) {
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...(replay ? { 'Idempotency-Replay': 'true' } : {}),
    },
  })
}

// Идемпотентность для money-роутов. Без ключа — обычный путь.
// С ключом: если уже видели тот же ключ + тот же body — отдаём
// сохранённый ответ. Если ключ тот же, но body другой — 409 (клиент
// сам решил отправить разные данные под одним ключом, это всегда баг).
//
// Хранение только в Postgres: file-backend = single-process, ему
// дедуп бессмысленен (in-memory достаточно), плюс файловый JSON
// плохо переживает быстрые конкурентные записи.
//
// CONTRACT (precisely — post-merge paranoia round 2 fix-forward,
// 2026-05-17):
//
//   This helper deduplicates SEQUENTIAL same-key replays. The
//   lookup → execute → save flow has NO inter-request reservation.
//   Two parallel requests arriving with the SAME Idempotency-Key
//   within the executor's runtime window MAY BOTH run the executor
//   (their side effects fire twice) — the ON CONFLICT save then
//   keeps only one cached response.
//
//   A previous attempt (rolled back) wrapped the whole flow in a
//   session-scoped pg_advisory_lock on a dedicated client. That
//   serialised correctly under low concurrency, but under N ≥
//   DATABASE_POOL_MAX concurrent same-key requests, each waiter
//   held a pool connection while blocked on the lock — the winner
//   couldn't get a second connection for the cached lookup/save
//   and the whole pool deadlocked. So the fix shipped a worse bug
//   than the one it claimed to close. Honest contract: dedup
//   SEQUENTIAL replay only.
//
//   For routes where concurrent same-key dedup matters (Resend send,
//   payment INSERT, etc.) the route layer adds its own atomic
//   coordination — usually a pg_advisory_xact_lock keyed on a
//   domain invariant (e.g. PKG-ADMIN-GRANT's pkg-stack:account:
//   duration). Don't ask this helper to do more than it does.
export async function withIdempotency(
  request: Request,
  scope: string,
  rawBody: string,
  executor: () => Promise<IdempotencyOutcome>,
): Promise<NextResponse> {
  const key = request.headers.get('idempotency-key')

  if (!key) {
    const outcome = await executor()
    return jsonResponse(outcome, false)
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return NextResponse.json(
      { error: 'Invalid Idempotency-Key header.' },
      { status: 400 },
    )
  }

  if (paymentConfig.storageBackend !== 'postgres') {
    const outcome = await executor()
    return jsonResponse(outcome, false)
  }

  const requestHash = sha256Hex(rawBody)

  await ensureIdempotencySchemaPostgres()
  const existing = await getIdempotencyRecordPostgres(scope, key)

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return NextResponse.json(
        {
          error:
            'Idempotency-Key reused with a different request body. Use a fresh key.',
        },
        { status: 409 },
      )
    }

    return jsonResponse(
      { status: existing.responseStatus, body: existing.responseBody },
      true,
    )
  }

  const outcome = await executor()

  // Сохраняем только успешные и осмысленные клиентские ответы.
  // 5xx — это сбой инфры, его не нужно «замораживать» под idempotency,
  // повторный запрос с тем же ключом должен попробовать снова.
  if (outcome.status < 500) {
    try {
      await saveIdempotencyRecordPostgres({
        scope,
        key,
        requestHash,
        responseStatus: outcome.status,
        responseBody: outcome.body,
      })
    } catch (error) {
      console.warn(
        'idempotency: failed to persist record',
        error instanceof Error ? error.message : error,
      )
    }
  }

  return jsonResponse(outcome, false)
}
