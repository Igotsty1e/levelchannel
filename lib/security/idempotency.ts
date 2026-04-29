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
