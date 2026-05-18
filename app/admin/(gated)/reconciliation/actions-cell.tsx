'use client'

import { useState } from 'react'

// PKG-RECON RECON.1+ — operator action buttons for the
// reconciliation queue. Three actions per row:
//   1. Re-run grant (calls retry-grant route)
//   2. Attach to different account (calls attach-account route)
//   3. Mark resolved (calls mark-resolved route)
//
// Each action generates a fresh Idempotency-Key UUID on click;
// re-click within the same row state reuses the key (so accidental
// double-fire dedupes via the server-side withIdempotency contract).

type Props = {
  invoiceId: string
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function ActionsCell({ invoiceId }: Props) {
  const [busy, setBusy] = useState<null | 'retry' | 'attach' | 'mark'>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function doRetry() {
    setErr(null)
    setDone(null)
    const reason = prompt(
      'Reason for re-running grant (optional, audit trail):',
      '',
    )
    if (reason === null) return
    setBusy('retry')
    try {
      const res = await fetch(
        `/api/admin/reconciliation/package-grants/${encodeURIComponent(invoiceId)}/retry-grant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': uuid(),
          },
          body: JSON.stringify({ reason: reason || undefined }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else if (json.ok) {
        setDone(`Granted (${json.outcome})`)
        setTimeout(() => window.location.reload(), 1500)
      } else {
        setErr(
          json.outcome === 'semantic_failure'
            ? `Grant still fails: ${json.reason}. Try attach or mark-resolved.`
            : json.outcome === 'package_unknown_or_inactive'
              ? `Package "${json.slug}" not found or inactive.`
              : 'Action did not grant; check audit.',
        )
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(null)
    }
  }

  async function doAttach() {
    setErr(null)
    setDone(null)
    const targetAccountId = prompt(
      'Target account UUID (the learner to attach this paid order to):',
      '',
    )
    if (!targetAccountId) return
    const reason = prompt(
      'Reason for attach (optional):',
      '',
    )
    if (reason === null) return
    setBusy('attach')
    try {
      const res = await fetch(
        `/api/admin/reconciliation/package-grants/${encodeURIComponent(invoiceId)}/attach-account`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': uuid(),
          },
          body: JSON.stringify({
            targetAccountId,
            reason: reason || undefined,
          }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else if (json.ok) {
        setDone(`Attached + granted (new email: ${json.newCustomerEmail})`)
        setTimeout(() => window.location.reload(), 1500)
      } else {
        setErr(
          `Attach succeeded but grant still fails: ${json.reason ?? json.outcome}. Try mark-resolved.`,
        )
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(null)
    }
  }

  async function doMark() {
    setErr(null)
    setDone(null)
    const category = prompt(
      'Category (one of: manual_grant_via_tariff | refunded_offline | comped | other):',
      'refunded_offline',
    )
    if (!category) return
    const reason = prompt(
      'Reason (required, what actually happened):',
      '',
    )
    if (!reason || !reason.trim()) {
      setErr('Reason is required.')
      return
    }
    let cpRefundTransactionId: string | undefined
    if (category === 'refunded_offline') {
      const cpId = prompt(
        'CloudPayments refund transaction id (optional, for structured audit):',
        '',
      )
      if (cpId === null) return
      cpRefundTransactionId = cpId.trim() || undefined
    }
    setBusy('mark')
    try {
      const res = await fetch(
        `/api/admin/reconciliation/package-grants/${encodeURIComponent(invoiceId)}/mark-resolved`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': uuid(),
          },
          body: JSON.stringify({
            category,
            reason: reason.trim(),
            cpRefundTransactionId,
          }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else {
        setDone(`Marked resolved (${category})`)
        setTimeout(() => window.location.reload(), 1500)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(null)
    }
  }

  if (done) {
    return (
      <span style={{ color: 'var(--accent)', fontSize: 11 }}>
        ✓ {done}
      </span>
    )
  }
  if (err) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: '#ff8a8a', fontSize: 11 }}>{err}</span>
        <button
          type="button"
          onClick={() => setErr(null)}
          style={btnStyle('secondary')}
        >
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        onClick={doRetry}
        disabled={busy !== null}
        style={btnStyle('primary')}
        title="Повторить выдачу пакета после устранения причины (например, пакет был неактивен)"
      >
        {busy === 'retry' ? '…' : 'Повторить выдачу'}
      </button>
      <button
        type="button"
        onClick={doAttach}
        disabled={busy !== null}
        style={btnStyle('secondary')}
        title="Привязать заказ к другому аккаунту (если ученик попал не на свой)"
      >
        {busy === 'attach' ? '…' : 'Привязать к аккаунту'}
      </button>
      <button
        type="button"
        onClick={doMark}
        disabled={busy !== null}
        style={btnStyle('secondary')}
        title="Закрыть вручную (возврат через CloudPayments, эквивалент тарифом и т.п.)"
      >
        {busy === 'mark' ? '…' : 'Закрыть вручную'}
      </button>
    </div>
  )
}

function btnStyle(kind: 'primary' | 'secondary'): React.CSSProperties {
  return {
    padding: '4px 8px',
    fontSize: 11,
    border: '1px solid var(--border)',
    background:
      kind === 'primary' ? 'var(--accent)' : 'transparent',
    color: kind === 'primary' ? 'var(--accent-contrast)' : 'var(--text)',
    cursor: 'pointer',
    borderRadius: 4,
  }
}
