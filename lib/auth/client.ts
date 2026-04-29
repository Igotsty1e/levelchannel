// Browser-side helper for the four auth forms in app/register|login|forgot|reset.
// Centralizes JSON shape, error normalization, and rate-limit handling so the
// UI components stay tiny.

export type AuthFormResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number }

export async function postAuthJson(path: string, body: Record<string, unknown>): Promise<AuthFormResult> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    return { ok: false, error: 'Сеть недоступна. Попробуйте ещё раз.', status: 0 }
  }

  let payload: Record<string, unknown> = {}
  try {
    payload = await res.json()
  } catch {
    // Non-JSON body (rare): fall through to status-based message
  }

  if (res.ok) {
    return { ok: true, data: payload }
  }

  if (res.status === 429) {
    return { ok: false, error: 'Слишком много попыток. Подождите минуту.', status: 429 }
  }

  const fromBody = typeof payload.error === 'string' ? payload.error.trim() : ''
  if (fromBody) {
    return { ok: false, error: fromBody, status: res.status }
  }

  return { ok: false, error: 'Что-то пошло не так. Попробуйте ещё раз.', status: res.status }
}
