'use client'

import Link from 'next/link'
import { useState } from 'react'

import type { PricingTariff } from '@/lib/pricing/tariffs'

// SAAS-PIVOT Epic 2 Day 3 — /teacher/tariffs client island.
//
// Mirrors the admin pricing editor's UX but with three differences:
//   1. No global "Slug" picker for create — we synthesise a stable
//      slug from titleRu + a short random suffix on the server. The
//      operator-style UX of picking slugs doesn't suit teachers.
//   2. Soft-delete instead of hard delete. The button is "Архивировать";
//      the confirm dialog says "это скроет тариф из новых слотов;
//      история сохранится".
//   3. The session's teacher_account_id is bound at the server (via
//      requireTeacherAndVerified guard); the client NEVER passes it.

export function TeacherTariffEditor({
  initialTariffs,
  showArchived,
}: {
  initialTariffs: PricingTariff[]
  showArchived: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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

  const active = initialTariffs.filter((t) => t.deletedAt === null)
  const archived = initialTariffs.filter((t) => t.deletedAt !== null)

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

      {active.map((t) => (
        <TeacherTariffRow
          key={t.id}
          tariff={t}
          onPatch={async (patch) => {
            const r = await postJson(
              'PATCH',
              `/api/teacher/tariffs/${t.id}`,
              patch,
            )
            return r.ok
          }}
          onArchive={() =>
            postJson('DELETE', `/api/teacher/tariffs/${t.id}`)
          }
          busy={busy}
        />
      ))}

      <NewTariffForm
        onCreate={async (input) => {
          const r = await postJson('POST', '/api/teacher/tariffs', input)
          return r.ok
        }}
        busy={busy}
      />

      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <Link
          href={
            showArchived ? '/teacher/tariffs' : '/teacher/tariffs?archived=1'
          }
          style={{
            color: 'var(--secondary)',
            fontSize: 13,
            textDecoration: 'underline',
          }}
        >
          {showArchived
            ? '← Скрыть архив'
            : 'Показать архив (тарифы со снятой привязкой)'}
        </Link>
        {showArchived ? (
          <div
            style={{
              marginTop: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {archived.length === 0 ? (
              <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
                Архив пуст.
              </p>
            ) : (
              archived.map((t) => <ArchivedTariffRow key={t.id} tariff={t} />)
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function TeacherTariffRow({
  tariff,
  onPatch,
  onArchive,
  busy,
}: {
  tariff: PricingTariff
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>
  onArchive: () => Promise<{ ok: true } | { ok: false; message: string }>
  busy: boolean
}) {
  const [titleRu, setTitleRu] = useState(tariff.titleRu)
  const [amountRub, setAmountRub] = useState(
    String((tariff.amountKopecks / 100).toFixed(2)),
  )
  const [duration, setDuration] = useState(String(tariff.durationMinutes))
  const [isActive, setIsActive] = useState(tariff.isActive)
  const [order, setOrder] = useState(String(tariff.displayOrder))
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

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
          gridTemplateColumns: '1fr 140px 120px 100px 80px',
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
          <Label title="Длительность одного занятия. После первой привязки к слоту изменить нельзя.">
            Длительность
          </Label>
          <DurationSelect value={duration} onChange={setDuration} />
        </div>
        <div>
          <Label title="Меньшее число — выше в списке цен при создании слота.">
            Позиция в списке
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
              durationMinutes: Number(duration),
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
          onClick={() => setConfirmArchive(true)}
          title="Архивировать тариф (скроет из новых слотов, история сохранится)"
          aria-label="Архивировать тариф"
          style={{
            marginLeft: 'auto',
            padding: '6px 10px',
            background: 'transparent',
            color: '#ffcb6b',
            border: '1px solid #ffcb6b55',
            borderRadius: 6,
            fontSize: 13,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Архивировать
        </button>
      </div>
      {confirmArchive ? (
        <ArchiveConfirm
          tariffTitle={tariff.titleRu || tariff.slug}
          errorMessage={archiveError}
          onCancel={() => {
            setConfirmArchive(false)
            setArchiveError(null)
          }}
          onConfirm={async () => {
            setArchiveError(null)
            const r = await onArchive()
            if (!r.ok) {
              setArchiveError(r.message)
            }
          }}
          busy={busy}
        />
      ) : null}
    </div>
  )
}

function ArchivedTariffRow({ tariff }: { tariff: PricingTariff }) {
  return (
    <div
      style={{
        border: '1px dashed var(--border)',
        borderRadius: 8,
        padding: 12,
        opacity: 0.65,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500 }}>
        {tariff.titleRu || tariff.slug}
      </span>
      <span
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          color: 'var(--secondary)',
        }}
      >
        {tariff.slug}
      </span>
      <span style={{ fontSize: 13, color: 'var(--secondary)' }}>
        {(tariff.amountKopecks / 100).toFixed(0)} ₽ · {tariff.durationMinutes} мин
      </span>
      <span style={{ fontSize: 12, color: '#ffcb6b' }}>
        архив с {tariff.deletedAt ? tariff.deletedAt.slice(0, 10) : '—'}
      </span>
    </div>
  )
}

function ArchiveConfirm({
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
          Архивировать тариф «{tariffTitle}»?
        </h3>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: '#a1a1aa' }}>
          После архивирования тариф пропадёт из форм создания слотов,
          но история сохранится: уже созданные слоты продолжают видеть
          его название и цену.
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
              background: '#ffcb6b',
              color: '#1f1f23',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Архивируем…' : 'Архивировать'}
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
  const [titleRu, setTitleRu] = useState('')
  const [amountRub, setAmountRub] = useState('3500')
  const [order, setOrder] = useState('0')
  const [duration, setDuration] = useState('60')

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
          gridTemplateColumns: '1fr 140px 120px 80px auto',
          gap: 12,
          alignItems: 'end',
        }}
      >
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
          <Label title="Длительность одного занятия по этому тарифу.">
            Длительность
          </Label>
          <DurationSelect value={duration} onChange={setDuration} />
        </div>
        <div>
          <Label title="Меньшее число — выше в списке.">Позиция в списке</Label>
          <Input
            type="number"
            step="1"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={busy || titleRu.trim().length === 0}
          onClick={() =>
            onCreate({
              titleRu,
              amountKopecks: Math.round(Number(amountRub) * 100),
              durationMinutes: Number(duration),
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
            opacity: busy || titleRu.trim().length === 0 ? 0.6 : 1,
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

function DurationSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const standard = ['30', '45', '60', '90']
  const isCustom = !standard.includes(value)
  return (
    <select
      value={isCustom ? '__custom' : value}
      onChange={(e) => {
        if (e.target.value === '__custom') return
        onChange(e.target.value)
      }}
      style={{
        width: '100%',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '8px 10px',
        color: 'var(--text)',
        fontSize: 13,
      }}
    >
      <option value="30">30 мин</option>
      <option value="45">45 мин</option>
      <option value="60">60 мин</option>
      <option value="90">90 мин</option>
      {isCustom ? <option value="__custom">{value} мин (custom)</option> : null}
    </select>
  )
}
