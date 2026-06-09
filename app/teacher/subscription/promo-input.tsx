'use client'

import { FormEvent, useState } from 'react'

import { track } from '@/lib/analytics/track'

const ERROR_COPY: Record<string, string> = {
  unknown_code: 'Такой код не найден. Проверьте, нет ли лишних пробелов.',
  revoked: 'Этот код был отозван.',
  not_yet_valid: 'Код ещё не действует — попробуйте позже.',
  expired: 'Срок действия кода истёк.',
  exhausted: 'Лимит активаций этого кода исчерпан.',
  account_unavailable: 'Аккаунт временно недоступен.',
  email_not_verified: 'Сначала подтвердите e-mail в настройках кабинета.',
  active_paid_subscription:
    'У вас уже активная платная подписка — код можно активировать после её окончания.',
  already_redeemed: 'Вы уже активировали этот код.',
}

function fmt(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function PromoCodeInput() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState<{ days: number; until: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function codePrefix(): string {
    return code.trim().slice(0, 4)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setSuccess(null)
    setErr(null)
    track('promo_code_redeem_attempted', { code_prefix: codePrefix() })
    try {
      const res = await fetch('/api/teacher/promo-codes/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        grantedDays?: number
        grantedUntil?: string
        error?: string
      } | null
      if (res.ok && body?.ok && body.grantedDays && body.grantedUntil) {
        setSuccess({ days: body.grantedDays, until: body.grantedUntil })
        setCode('')
        track('promo_code_redeem_succeeded', {
          code_prefix: codePrefix(),
          granted_days: body.grantedDays,
        })
        // Force a soft refresh so the active-tier card updates.
        setTimeout(() => window.location.reload(), 1500)
      } else {
        const reason = body?.error ?? 'unknown_error'
        setErr(ERROR_COPY[reason] ?? 'Не получилось активировать. Попробуйте ещё раз.')
        track('promo_code_redeem_failed', { code_prefix: codePrefix(), reason })
      }
    } catch {
      setErr('Сетевая ошибка. Проверьте подключение.')
      track('promo_code_redeem_failed', {
        code_prefix: codePrefix(),
        reason: 'network',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      id="promo"
      style={{
        marginTop: 24,
        padding: 16,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>Промокод</h2>
      <p style={{ color: 'var(--secondary)', fontSize: 13, lineHeight: 1.5, margin: '0 0 12px' }}>
        Если у вас есть код — введите его и получите доступ к платному тарифу бесплатно
        на указанный срок.
      </p>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onFocus={() => track('promo_code_form_focused', {})}
          placeholder="LAUNCH3"
          maxLength={32}
          autoCapitalize="characters"
          spellCheck={false}
          disabled={busy}
          required
          style={{
            flex: '1 1 200px',
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 14,
            textTransform: 'uppercase',
          }}
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          style={{
            padding: '8px 18px',
            border: 'none',
            borderRadius: 4,
            background: busy ? 'var(--border)' : 'var(--accent)',
            color: '#fff',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {busy ? 'Активируем…' : 'Активировать'}
        </button>
      </form>
      {success ? (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 6,
            background: 'rgba(74, 222, 128, 0.10)',
            border: '1px solid rgba(74, 222, 128, 0.4)',
            color: 'var(--text)',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          Активировано: {success.days} дней Расширенного тарифа до {fmt(success.until)}.
        </div>
      ) : null}
      {err ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 6,
            background: 'rgba(248, 113, 113, 0.08)',
            border: '1px solid rgba(248, 113, 113, 0.4)',
            color: 'var(--text)',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {err}
        </div>
      ) : null}
    </section>
  )
}
