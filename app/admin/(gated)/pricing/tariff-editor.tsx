'use client'

import { useState } from 'react'

import type { PricingTariff } from '@/lib/pricing/tariffs'

// Single client island for the pricing page. Inline-editable rows +
// "add new" form. Server-rendered data comes through `initialTariffs`;
// after each successful API hit we reload the page rather than
// re-rendering optimistically — fewer edge cases.

export function TariffEditor({
  initialTariffs,
}: {
  initialTariffs: PricingTariff[]
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // postJson returns:
  //   - { ok: true } — caller reloads
  //   - { ok: false, message } — caller renders message inline; the
  //     top-of-editor `err` banner is ALSO populated as a fallback for
  //     contexts (e.g. PATCH on a long list) where the user might miss
  //     a row-local error.
  async function postJson(
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        const message: string =
          data?.message || data?.error || `HTTP ${res.status}`
        setErr(message)
        setBusy(false)
        return { ok: false, message }
      }
      window.location.reload()
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown'
      setErr(message)
      setBusy(false)
      return { ok: false, message }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {err ? (
        <div
          style={{
            background: 'rgba(255, 138, 138, 0.08)',
            border: '1px solid #ff8a8a55',
            color: '#ffcfcf',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {err}
        </div>
      ) : null}

      {initialTariffs.map((t) => (
        <TariffRow
          key={t.id}
          tariff={t}
          onPatch={async (patch) => {
            const r = await postJson(
              'PATCH',
              `/api/admin/pricing/${t.id}`,
              patch,
            )
            return r.ok
          }}
          onDelete={() =>
            postJson('DELETE', `/api/admin/pricing/${t.id}`)
          }
          busy={busy}
        />
      ))}

      <NewTariffForm
        onCreate={async (input) => {
          const r = await postJson('POST', '/api/admin/pricing', input)
          return r.ok
        }}
        busy={busy}
      />
    </div>
  )
}

function TariffRow({
  tariff,
  onPatch,
  onDelete,
  busy,
}: {
  tariff: PricingTariff
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>
  onDelete: () => Promise<{ ok: true } | { ok: false; message: string }>
  busy: boolean
}) {
  const [titleRu, setTitleRu] = useState(tariff.titleRu)
  const [amountRub, setAmountRub] = useState(
    String((tariff.amountKopecks / 100).toFixed(2)),
  )
  const [isActive, setIsActive] = useState(tariff.isActive)
  const [order, setOrder] = useState(String(tariff.displayOrder))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 16,
        opacity: tariff.isActive ? 1 : 0.55,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 140px 100px 80px',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div>
          <Label>Название</Label>
          <Input
            value={titleRu}
            onChange={(e) => setTitleRu(e.target.value)}
          />
          <p
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              color: 'var(--secondary)',
              marginTop: 4,
            }}
          >
            {tariff.slug}
          </p>
        </div>
        <div>
          <Label>Сумма, ₽</Label>
          <Input
            type="number"
            step="0.01"
            min="1"
            value={amountRub}
            onChange={(e) => setAmountRub(e.target.value)}
          />
        </div>
        <div>
          <Label title="Меньшее число — выше в списке для оператора (форма создания слота, дропдаун выбора тарифа). На стоимость и публичный сайт не влияет.">
            Порядок (для админки)
          </Label>
          <Input
            type="number"
            step="1"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </div>
        <div>
          <Label>&nbsp;</Label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            активен
          </label>
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onPatch({
              titleRu,
              amountKopecks: Math.round(Number(amountRub) * 100),
              displayOrder: Number(order),
              isActive,
            })
          }
          style={{
            padding: '6px 14px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Сохранить
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
          title="Удалить тариф (только если он никогда не был привязан к слоту)"
          aria-label="Удалить тариф"
          style={{
            marginLeft: 'auto',
            padding: '6px 10px',
            background: 'transparent',
            color: '#ff8a8a',
            border: '1px solid #ff8a8a55',
            borderRadius: 6,
            fontSize: 13,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          🗑 Удалить
        </button>
      </div>
      {confirmDelete ? (
        <DeleteConfirm
          tariffTitle={tariff.titleRu || tariff.slug}
          errorMessage={deleteError}
          onCancel={() => {
            setConfirmDelete(false)
            setDeleteError(null)
          }}
          onConfirm={async () => {
            setDeleteError(null)
            const r = await onDelete()
            if (!r.ok) {
              // Modal stays open so the operator sees WHY right there,
              // next to the offending row. Top-of-editor banner is
              // still populated by postJson as a fallback.
              setDeleteError(r.message)
            }
            // On success postJson reloads; nothing more to do here.
          }}
          busy={busy}
        />
      ) : null}
    </div>
  )
}

function DeleteConfirm({
  tariffTitle,
  errorMessage,
  onConfirm,
  onCancel,
  busy,
}: {
  tariffTitle: string
  errorMessage: string | null
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  busy: boolean
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={busy ? undefined : onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1f1f23',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 24,
          maxWidth: 460,
          color: '#e4e4e7',
        }}
      >
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>
          Удалить тариф «{tariffTitle}»?
        </h3>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: '#a1a1aa' }}>
          Удаление невозможно, если тариф уже был привязан хотя бы к
          одному слоту (это сломает аудит-связь). В таком случае
          сервер вернёт ошибку, а вместо удаления используйте
          снятие галочки «активен» — тариф пропадёт из новых форм.
        </p>
        {errorMessage ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 6,
              color: '#fecaca',
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {errorMessage}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 20,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              color: '#e4e4e7',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              fontSize: 13,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            style={{
              padding: '6px 14px',
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Удаляем…' : 'Удалить'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NewTariffForm({
  onCreate,
  busy,
}: {
  onCreate: (input: Record<string, unknown>) => Promise<boolean>
  busy: boolean
}) {
  const [slug, setSlug] = useState('')
  const [titleRu, setTitleRu] = useState('')
  const [amountRub, setAmountRub] = useState('3500')
  const [order, setOrder] = useState('0')

  return (
    <div
      style={{
        border: '1px dashed var(--border)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        Добавить тариф
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '180px 1fr 140px 80px auto',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <div>
          <Label>Slug</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="lesson-60min"
          />
        </div>
        <div>
          <Label>Название</Label>
          <Input
            value={titleRu}
            onChange={(e) => setTitleRu(e.target.value)}
            placeholder="Урок 60 минут"
          />
        </div>
        <div>
          <Label>Сумма, ₽</Label>
          <Input
            type="number"
            step="0.01"
            min="1"
            value={amountRub}
            onChange={(e) => setAmountRub(e.target.value)}
          />
        </div>
        <div>
          <Label title="Меньшее число — выше в списке для оператора (форма создания слота, дропдаун выбора тарифа). На стоимость и публичный сайт не влияет.">
            Порядок (для админки)
          </Label>
          <Input
            type="number"
            step="1"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onCreate({
              slug,
              titleRu,
              amountKopecks: Math.round(Number(amountRub) * 100),
              displayOrder: Number(order),
              isActive: true,
            })
          }
          style={{
            padding: '8px 14px',
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Создать
        </button>
      </div>
    </div>
  )
}

function Label({
  children,
  title,
}: {
  children: React.ReactNode
  title?: string
}) {
  return (
    <div
      title={title}
      style={{
        color: 'var(--secondary)',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: 4,
        cursor: title ? 'help' : undefined,
      }}
    >
      {children}
      {title ? (
        <span aria-hidden="true" style={{ marginLeft: 4, opacity: 0.7 }}>
          ⓘ
        </span>
      ) : null}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '8px 10px',
        color: 'var(--text)',
        fontSize: 13,
        ...(props.style ?? {}),
      }}
    />
  )
}
