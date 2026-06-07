'use client'

import { useMemo, useState } from 'react'

import { Banner } from '@/components/ui/primitives/banner'
import { Button } from '@/components/ui/primitives/button'
import { ChipGroup, type ChipOption } from '@/components/ui/primitives/chip-group'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import type { AccountProfile } from '@/lib/auth/profiles'
import { TIMEZONE_OPTIONS, safeTimezone } from '@/lib/auth/timezones'

// Deep UX redesign of /teacher/profile (2026-06-07).
//
// Owner requested the same craftsmanship pass /teacher/tariffs got:
//   - Single card per concern, design-system tokens, Button primitive.
//   - Name = two inputs side-by-side on desktop, stacked on mobile.
//   - Timezone = ChipGroup of the 4 most-used RU zones + «Другой»
//     fallback that reveals the full <select>. Removes the wall-of-50
//     dropdown that the previous editor exposed by default.
//   - Live name preview keeps the original «как мы будем к вам
//     обращаться» reassurance.
//   - Save is the design-system Button — `loading={busy}` + `disabled`
//     until the form is dirty.
//
// Component is teacher-cabinet-specific by intent: it always enforces
// explicit timezone (the learner's editor still defaults to Moscow,
// because learner UI has no calendar gate).

const QUICK_TIMEZONES: ReadonlyArray<ChipOption<string>> = [
  { value: 'Europe/Moscow', label: 'Москва' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск' },
  { value: 'Asia/Vladivostok', label: 'Владивосток' },
]

const OTHER_VALUE = '__other__'

const QUICK_TZ_IDS = new Set(QUICK_TIMEZONES.map((o) => o.value))

type SaveState =
  | { kind: 'idle' }
  | { kind: 'ok'; at: string }
  | { kind: 'err'; message: string }

export function TeacherProfileCard({
  initialProfile,
  fallbackEmail,
}: {
  initialProfile: AccountProfile | null
  fallbackEmail: string
}) {
  const initialFirstName = initialProfile?.firstName ?? ''
  const initialLastName = initialProfile?.lastName ?? ''
  const initialTzRaw = initialProfile?.timezone ?? null
  // Teacher surface — null tz stays null (no Moscow auto-default).
  // Learner cabinet keeps the legacy safeTimezone() fallback in its
  // own editor.
  const initialTz = initialTzRaw == null ? '' : safeTimezone(initialTzRaw)

  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [timezone, setTimezone] = useState(initialTz)
  // «Другой» mode = chip-row toggled to the long-list dropdown. We
  // initialise it open when the stored tz is outside the QUICK_TIMEZONES
  // set (so the teacher sees their actual saved value, not a stale
  // chip default).
  const [otherMode, setOtherMode] = useState(
    initialTz !== '' && !QUICK_TZ_IDS.has(initialTz),
  )

  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<SaveState>({ kind: 'idle' })

  const previewName = formatProfileNameForRender({
    firstName,
    lastName,
    displayName: initialProfile?.displayName ?? null,
    fallbackEmail,
  })

  // Dirty = any field changed from its initial value. Save button stays
  // disabled until then.
  const dirty = useMemo(() => {
    if (firstName !== initialFirstName) return true
    if (lastName !== initialLastName) return true
    if (timezone !== initialTz) return true
    return false
  }, [firstName, lastName, timezone, initialFirstName, initialLastName, initialTz])

  const tzMissing = timezone.trim() === ''
  const canSave = dirty && !busy && !tzMissing

  // Chip selection: «Москва», «Екатеринбург», … set the tz directly.
  // «Другой» reveals the dropdown and leaves the value unchanged so
  // the teacher can pick a non-quick option without losing context.
  const chipValue = otherMode || !QUICK_TZ_IDS.has(timezone) ? OTHER_VALUE : timezone
  const chipOptions: ReadonlyArray<ChipOption<string>> = [
    ...QUICK_TIMEZONES,
    { value: OTHER_VALUE, label: 'Другой' },
  ]

  function onChipChange(next: string) {
    if (next === OTHER_VALUE) {
      setOtherMode(true)
      // Keep current tz so the dropdown opens on the saved value (or
      // empty for first-time setup).
      return
    }
    setOtherMode(false)
    setTimezone(next)
  }

  async function onSave() {
    if (!canSave) return
    setBusy(true)
    setState({ kind: 'idle' })
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim() === '' ? null : firstName.trim(),
          lastName: lastName.trim() === '' ? null : lastName.trim(),
          timezone: timezone.trim() === '' ? null : timezone.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        const message =
          (data && (data.message || data.error)) || `HTTP ${res.status}`
        setState({ kind: 'err', message: String(message) })
      } else {
        setState({
          kind: 'ok',
          at: new Date().toLocaleTimeString('ru-RU'),
        })
      }
    } catch (e) {
      setState({
        kind: 'err',
        message: e instanceof Error ? e.message : 'unknown',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="teacher-profile-card-title"
      style={cardStyle}
    >
      <header style={cardHeaderStyle}>
        <h2 id="teacher-profile-card-title" style={cardTitleStyle}>
          Имя и часовой пояс
        </h2>
        <p style={cardSubStyle}>
          Это то, что увидят ученики в письмах и в кабинете.
        </p>
      </header>

      {/* Name row — 2 inputs side-by-side on desktop, stack on mobile. */}
      <div className="tprofile-name-row">
        <FormField label="Имя" htmlFor="tprofile-first">
          <input
            id="tprofile-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Анна"
            maxLength={60}
            autoComplete="given-name"
            style={inputStyle}
          />
        </FormField>
        <FormField label="Фамилия" htmlFor="tprofile-last">
          <input
            id="tprofile-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Петрова"
            maxLength={60}
            autoComplete="family-name"
            style={inputStyle}
          />
        </FormField>
      </div>
      <p style={previewLineStyle}>
        Как мы будем к тебе обращаться:{' '}
        <span style={{ color: 'var(--text)' }}>{previewName}</span>
      </p>

      {/* Timezone section — chips first, dropdown only when needed. */}
      <div style={{ marginTop: 20 }}>
        <span style={fieldLabelStyle}>Часовой пояс</span>
        <ChipGroup
          name="tprofile-timezone"
          value={chipValue}
          options={chipOptions}
          onChange={onChipChange}
        />
        {otherMode || (timezone !== '' && !QUICK_TZ_IDS.has(timezone)) ? (
          <div style={{ marginTop: 10 }}>
            <select
              aria-label="Часовой пояс (полный список)"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={inputStyle}
            >
              {timezone === '' ? (
                <option value="" disabled>
                  — Выбери часовой пояс —
                </option>
              ) : null}
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {tzMissing ? (
          <p style={{ ...hintStyle, color: 'var(--warning)' }}>
            Часовой пояс ещё не выбран — расписание и календарь без него
            работают некорректно.
          </p>
        ) : null}
      </div>

      {/* Status banner — only when there's something to say. */}
      {state.kind === 'err' ? (
        <div style={{ marginTop: 16 }}>
          <Banner tone="danger" icon="⚠">
            Не удалось сохранить: {state.message}
          </Banner>
        </div>
      ) : null}
      {state.kind === 'ok' ? (
        <div style={{ marginTop: 16 }}>
          <Banner tone="success" icon="✓">
            Сохранено в {state.at}
          </Banner>
        </div>
      ) : null}

      {/* Action bar. */}
      <div style={actionsRowStyle}>
        <Button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          loading={busy}
        >
          Сохранить
        </Button>
        {!dirty && state.kind === 'idle' ? (
          <span style={mutedHintStyle}>
            Изменений нет — поменяй поле, чтобы стало можно сохранить.
          </span>
        ) : null}
      </div>
    </section>
  )
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block' }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  )
}

// — styles —
// Token-only. No hex / rgba outside the design-system tokens. All
// magic numbers come from §5 spacing scale (4·8·12·16·20·24).

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 24,
  marginBottom: 16,
}

const cardHeaderStyle: React.CSSProperties = {
  marginBottom: 20,
}

const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 600,
  lineHeight: 1.3,
  color: 'var(--text-primary, var(--text))',
}

const cardSubStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--secondary)',
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 8,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--secondary)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-2, transparent)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  // 16px prevents iOS from auto-zooming the viewport when the field
  // gains focus (Safari/iOS quirk).
  fontSize: 16,
  lineHeight: 1.4,
  color: 'var(--text)',
  fontVariantNumeric: 'tabular-nums',
  boxSizing: 'border-box',
}

const previewLineStyle: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--secondary)',
}

const hintStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: 12,
  lineHeight: 1.4,
}

const actionsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  marginTop: 20,
}

const mutedHintStyle: React.CSSProperties = {
  color: 'var(--text-tertiary, var(--secondary))',
  fontSize: 12,
  lineHeight: 1.4,
}
