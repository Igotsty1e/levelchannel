'use client'

import { useEffect, useState } from 'react'

import type { LessonSlot } from '@/lib/scheduling/slots'

type Teacher = { id: string; email: string }
type Learner = { id: string; email: string }
type TariffOption = {
  id: string
  slug: string
  titleRu: string
  amountKopecks: number
}

type Props = {
  initialTeachers: Teacher[]
  initialSlots: LessonSlot[]
  initialTariffs: TariffOption[]
  initialLearners: Learner[]
}

const TZ = 'Europe/Moscow'

const WEEKDAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(s: string): string {
  switch (s) {
    case 'open':
      return 'свободен'
    case 'booked':
      return 'занят'
    case 'cancelled':
      return 'отменён'
    case 'completed':
      return 'проведён'
    case 'no_show_learner':
      return 'не пришёл (учащийся)'
    case 'no_show_teacher':
      return 'не пришёл (учитель)'
    default:
      return s
  }
}

function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function SlotsManager({
  initialTeachers,
  initialSlots,
  initialTariffs,
  initialLearners,
}: Props) {
  const [slots, setSlots] = useState<LessonSlot[]>(initialSlots)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function refresh() {
    try {
      const r = await fetch('/api/admin/slots', { cache: 'no-store' })
      const j = await r.json()
      setSlots(j.slots ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unknown')
    }
  }

  function flash(message: string) {
    setInfo(message)
    setErr(null)
    setTimeout(() => setInfo(null), 4000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {info ? <Banner tone="ok">{info}</Banner> : null}
      {err ? <Banner tone="err">{err}</Banner> : null}

      <SingleCreate
        teachers={initialTeachers}
        tariffs={initialTariffs}
        onCreated={(msg) => {
          flash(msg)
          refresh()
        }}
        onError={(m) => setErr(m)}
        busy={busy}
        setBusy={setBusy}
      />

      <BulkCreate
        teachers={initialTeachers}
        tariffs={initialTariffs}
        onCreated={(msg) => {
          flash(msg)
          refresh()
        }}
        onError={(m) => setErr(m)}
        busy={busy}
        setBusy={setBusy}
      />

      <SlotList
        slots={slots}
        learners={initialLearners}
        onMutated={refresh}
        onError={(m) => setErr(m)}
        onInfo={(m) => flash(m)}
        busy={busy}
        setBusy={setBusy}
      />
    </div>
  )
}

function SingleCreate({
  teachers,
  tariffs,
  onCreated,
  onError,
  busy,
  setBusy,
}: {
  teachers: Teacher[]
  tariffs: TariffOption[]
  onCreated: (msg: string) => void
  onError: (m: string) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? '')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('18:00')
  const [duration, setDuration] = useState('60')
  const [notes, setNotes] = useState('')
  const [tariffId, setTariffId] = useState('')

  async function submit() {
    if (!teacherId || !date) return
    setBusy(true)
    try {
      const startAt = new Date(`${date}T${time}:00`).toISOString() // local browser tz
      const res = await fetch('/api/admin/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherAccountId: teacherId,
          startAt,
          durationMinutes: Number(duration),
          notes: notes || null,
          tariffId: tariffId || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        onError(data?.error || `HTTP ${res.status}`)
        return
      }
      onCreated('Слот создан.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
        Один слот
      </h2>
      {teachers.length === 0 ? (
        <p style={{ color: 'var(--secondary)', fontSize: 13 }}>
          Нет аккаунтов с ролью <code>teacher</code>. Сначала выдайте роль на{' '}
          <a href="/admin/accounts">/admin/accounts</a>.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          <Field label="Учитель">
            <Select value={teacherId} onChange={(v) => setTeacherId(v)}>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Дата">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={todayYmd()}
            />
          </Field>
          <Field label="Время">
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
          <Field label="Длительность, мин">
            <Input
              type="number"
              min="15"
              max="180"
              step="15"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          <Field label="Заметки (опц.)">
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Field label="Тариф (опц.)">
            <Select value={tariffId} onChange={(v) => setTariffId(v)}>
              <option value="">— без тарифа —</option>
              {tariffs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.titleRu} ({(t.amountKopecks / 100).toLocaleString('ru-RU')} ₽)
                </option>
              ))}
            </Select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              style={primaryBtnStyle(busy)}
            >
              Создать
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

function BulkCreate({
  teachers,
  tariffs,
  onCreated,
  onError,
  busy,
  setBusy,
}: {
  teachers: Teacher[]
  tariffs: TariffOption[]
  onCreated: (msg: string) => void
  onError: (m: string) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? '')
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([1, 3, 5]))
  const [time, setTime] = useState('18:00')
  const [date, setDate] = useState(todayYmd())
  const [weeks, setWeeks] = useState('4')
  const [duration, setDuration] = useState('60')
  const [notes, setNotes] = useState('')
  const [tariffId, setTariffId] = useState('')
  const [preview, setPreview] = useState<
    { startAt: string; date: string; time: string; selected: boolean }[]
  >([])

  function toggleWeekday(w: number) {
    const next = new Set(weekdays)
    if (next.has(w)) next.delete(w)
    else next.add(w)
    setWeekdays(next)
  }

  async function fetchPreview() {
    if (!teacherId) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/slots/bulk-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekdays: Array.from(weekdays),
          startTime: time,
          startDate: date,
          weeks: Number(weeks),
          durationMinutes: Number(duration),
          timezone: TZ,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        onError(data?.error || `HTTP ${res.status}`)
        setPreview([])
        return
      }
      setPreview(
        data.slots.map((s: { startAt: string; date: string; time: string }) => ({
          ...s,
          selected: true,
        })),
      )
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    const finalSlots = preview
      .filter((s) => s.selected)
      .map((s) => ({ startAt: s.startAt }))
    if (finalSlots.length === 0) {
      onError('Нечего создавать.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/slots/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherAccountId: teacherId,
          durationMinutes: Number(duration),
          notes: notes || null,
          tariffId: tariffId || null,
          slots: finalSlots,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        onError(data?.error || `HTTP ${res.status}`)
        return
      }
      const skippedNote =
        data.skippedConflicts?.length > 0
          ? ` (пропущено как дубль: ${data.skippedConflicts.length})`
          : ''
      onCreated(`Создано ${data.created.length} слотов${skippedNote}.`)
      setPreview([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
        Массовое создание
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <Field label="Учитель">
          <Select value={teacherId} onChange={(v) => setTeacherId(v)}>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Дни недели">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WEEKDAY_LABELS.map((lbl, i) => {
              const selected = weekdays.has(i)
              return (
              <button
                key={i}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleWeekday(i)}
                style={{
                  minWidth: 36,
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: selected ? 600 : 500,
                  border: selected
                    ? '1px solid var(--accent)'
                    : '1px solid var(--border)',
                  background: selected ? 'var(--accent)' : 'transparent',
                  color: selected ? 'var(--accent-contrast)' : 'var(--text)',
                  boxShadow: selected
                    ? '0 0 0 2px rgba(255,255,255,0.06) inset'
                    : 'none',
                  cursor: 'pointer',
                  transition: 'background 80ms ease, border-color 80ms ease',
                }}
              >
                {lbl}
              </button>
              )
            })}
          </div>
        </Field>
        <Field label="Время (МСК)">
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
        <Field label="Старт">
          <Input
            type="date"
            value={date}
            min={todayYmd()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Недель">
          <Input
            type="number"
            min="1"
            max="26"
            value={weeks}
            onChange={(e) => setWeeks(e.target.value)}
          />
        </Field>
        <Field label="Длительность, мин">
          <Input
            type="number"
            min="15"
            max="180"
            step="15"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <Field label="Заметки (опц.)">
          <Input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <Field label="Тариф (опц.)">
          <Select value={tariffId} onChange={(v) => setTariffId(v)}>
            <option value="">— без тарифа —</option>
            {tariffs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.titleRu} ({(t.amountKopecks / 100).toLocaleString('ru-RU')} ₽)
              </option>
            ))}
          </Select>
        </Field>
        <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
          <button
            type="button"
            disabled={busy}
            onClick={fetchPreview}
            style={primaryBtnStyle(busy)}
          >
            Превью
          </button>
        </div>
      </div>

      {preview.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--secondary)', marginBottom: 8 }}>
            {preview.length} слотов в плане. Снимите галочку, чтобы пропустить.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 6,
              maxHeight: 280,
              overflow: 'auto',
              padding: 8,
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            {preview.map((s, idx) => (
              <label
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={s.selected}
                  onChange={(e) => {
                    const next = [...preview]
                    next[idx] = { ...s, selected: e.target.checked }
                    setPreview(next)
                  }}
                />
                {fmt(s.startAt)}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={busy}
              onClick={commit}
              style={primaryBtnStyle(busy)}
            >
              Создать выбранные ({preview.filter((s) => s.selected).length})
            </button>
            <button
              type="button"
              onClick={() => setPreview([])}
              style={ghostBtnStyle()}
            >
              Очистить превью
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function SlotList({
  slots,
  learners,
  onMutated,
  onError,
  onInfo,
  busy,
  setBusy,
}: {
  slots: LessonSlot[]
  learners: Learner[]
  onMutated: () => void
  onError: (m: string) => void
  onInfo: (m: string) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const [filter, setFilter] = useState<
    'all' | 'open' | 'booked' | 'cancelled' | 'completed' | 'no_show'
  >('all')
  // Inline booking picker: which slot is in "picking learner" mode.
  // `null` = none expanded. Replaces window.prompt with a real
  // dropdown so the operator picks from existing learners.
  const [bookingForId, setBookingForId] = useState<string | null>(null)
  const [pickedLearnerEmail, setPickedLearnerEmail] = useState<string>(
    learners[0]?.email ?? '',
  )
  const filtered =
    filter === 'all'
      ? slots
      : filter === 'no_show'
        ? slots.filter(
            (s) =>
              s.status === 'no_show_learner' ||
              s.status === 'no_show_teacher',
          )
        : slots.filter((s) => s.status === filter)

  async function call(method: string, url: string, body?: unknown) {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        onError(data?.error || `HTTP ${res.status}`)
        return false
      }
      return true
    } finally {
      setBusy(false)
    }
  }

  async function cancel(s: LessonSlot) {
    const reason = window.prompt('Причина отмены (необязательно)') ?? ''
    if (
      !(await call(
        'POST',
        `/api/admin/slots/${s.id}/cancel`,
        reason ? { reason } : {},
      ))
    )
      return
    onInfo('Отменён.')
    onMutated()
  }

  async function del(s: LessonSlot) {
    if (!confirm('Удалить open-слот?')) return
    if (!(await call('DELETE', `/api/admin/slots/${s.id}`))) return
    onInfo('Удалено.')
    onMutated()
  }

  function startBooking(s: LessonSlot) {
    setBookingForId(s.id)
    if (!pickedLearnerEmail && learners[0]) {
      setPickedLearnerEmail(learners[0].email)
    }
  }

  function cancelBooking() {
    setBookingForId(null)
  }

  async function confirmBooking(s: LessonSlot) {
    const learnerEmail = pickedLearnerEmail.trim()
    if (!learnerEmail) {
      onError('Выберите ученика из списка.')
      return
    }
    if (
      !(await call('POST', `/api/admin/slots/${s.id}/book-as-operator`, {
        learnerEmail,
      }))
    )
      return
    onInfo(`Забронировано на ${learnerEmail}.`)
    setBookingForId(null)
    onMutated()
  }

  async function mark(
    s: LessonSlot,
    status: 'completed' | 'no_show_learner' | 'no_show_teacher',
  ) {
    if (
      !(await call('POST', `/api/admin/slots/${s.id}/mark`, { status }))
    )
      return
    onInfo('Статус обновлён.')
    onMutated()
  }

  return (
    <Card>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          Слоты ({slots.length})
        </h2>
        <Select value={filter} onChange={(v) => setFilter(v as typeof filter)}>
          <option value="all">все</option>
          <option value="open">свободные</option>
          <option value="booked">забронированные</option>
          <option value="completed">проведённые</option>
          <option value="no_show">не пришли</option>
          <option value="cancelled">отменённые</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: 'var(--secondary)', fontSize: 13 }}>Пусто.</p>
      ) : (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--secondary)',
                  textAlign: 'left',
                }}
              >
                <th style={{ padding: '8px 10px' }}>Когда</th>
                <th style={{ padding: '8px 10px' }}>Учитель</th>
                <th style={{ padding: '8px 10px' }}>Учащийся</th>
                <th style={{ padding: '8px 10px' }}>Тариф</th>
                <th style={{ padding: '8px 10px' }}>Статус</th>
                <th style={{ padding: '8px 10px' }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px' }}>{fmt(s.startAt)}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--secondary)' }}>
                    {s.teacherEmail ?? '—'}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--secondary)' }}>
                    {s.learnerEmail ?? '—'}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--secondary)' }}>
                    {s.tariffSlug
                      ? `${s.tariffSlug}${s.tariffAmountKopecks ? ` · ${(s.tariffAmountKopecks / 100).toLocaleString('ru-RU')}\u00a0₽` : ''}`
                      : '—'}
                  </td>
                  <td style={{ padding: '8px 10px' }}>{statusLabel(s.status)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {bookingForId === s.id ? (
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        {learners.length === 0 ? (
                          <span
                            style={{
                              color: 'var(--secondary)',
                              fontSize: 11,
                            }}
                          >
                            Нет подходящих учеников. Зарегистрируйте
                            ученика и подтвердите его e-mail сначала.
                          </span>
                        ) : (
                          <select
                            value={pickedLearnerEmail}
                            onChange={(e) =>
                              setPickedLearnerEmail(e.target.value)
                            }
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              padding: '4px 6px',
                              color: 'var(--text)',
                              fontSize: 12,
                              minWidth: 200,
                            }}
                          >
                            {learners.map((l) => (
                              <option key={l.id} value={l.email}>
                                {l.email}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          disabled={busy || learners.length === 0}
                          onClick={() => confirmBooking(s)}
                          style={smallBtnStyle()}
                        >
                          Подтвердить
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={cancelBooking}
                          style={smallDangerStyle()}
                        >
                          Отмена
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {s.status === 'open' ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => startBooking(s)}
                              style={smallBtnStyle()}
                            >
                              Забронировать
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => del(s)}
                              style={smallDangerStyle()}
                            >
                              Удалить
                            </button>
                          </>
                        ) : null}
                        {s.status === 'booked' &&
                        new Date(s.startAt).getTime() <= Date.now() ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => mark(s, 'completed')}
                              style={smallBtnStyle()}
                            >
                              Прошёл
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => mark(s, 'no_show_learner')}
                              style={smallDangerStyle()}
                            >
                              Не пришёл (учащ.)
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => mark(s, 'no_show_teacher')}
                              style={smallDangerStyle()}
                            >
                              Не пришёл (учит.)
                            </button>
                          </>
                        ) : null}
                        {s.status === 'booked' || s.status === 'open' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => cancel(s)}
                            style={smallDangerStyle()}
                          >
                            Отменить
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// --- atoms ---

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      {children}
    </div>
  )
}

function Banner({
  tone,
  children,
}: {
  tone: 'ok' | 'err'
  children: React.ReactNode
}) {
  const colors = {
    ok: { bg: 'rgba(155, 223, 155, 0.08)', border: 'rgba(155, 223, 155, 0.3)', fg: '#9bdf9b' },
    err: { bg: 'rgba(255, 138, 138, 0.08)', border: '#ff8a8a55', fg: '#ffcfcf' },
  }[tone]
  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.fg,
        padding: '8px 12px',
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span
        style={{
          display: 'block',
          color: 'var(--secondary)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
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
        padding: '6px 8px',
        color: 'var(--text)',
        fontSize: 13,
      }}
    />
  )
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '6px 8px',
        color: 'var(--text)',
        fontSize: 13,
      }}
    >
      {children}
    </select>
  )
}

function primaryBtnStyle(busy: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    padding: '6px 14px',
    background: 'transparent',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  }
}

function smallBtnStyle(): React.CSSProperties {
  return {
    padding: '4px 10px',
    background: 'var(--accent)',
    color: 'var(--accent-contrast)',
    border: 'none',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
  }
}

function smallDangerStyle(): React.CSSProperties {
  return {
    padding: '4px 10px',
    background: 'transparent',
    color: '#ffcfcf',
    border: '1px solid #ff8a8a55',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
  }
}
