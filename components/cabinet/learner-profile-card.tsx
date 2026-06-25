'use client'

import { useMemo, useState } from 'react'

import { Banner } from '@/components/ui/primitives/banner'
import { Button } from '@/components/ui/primitives/button'
import { ChipGroup, type ChipOption } from '@/components/ui/primitives/chip-group'
import { formatProfileNameForRender } from '@/lib/auth/profile-name'
import type { AccountProfile } from '@/lib/auth/profiles'
import { TIMEZONE_OPTIONS, safeTimezone } from '@/lib/auth/timezones'

// 2026-06-25 Bug 3 fix — переписан learner ProfileEditor по аналогии с
// TeacherProfileCard. Owner asked: «нужно по аналогии с кабинетом учителя
// сделать раздел с часовым поясом и указанием имени/фамилии».
//
// Visual contract:
//   - ChipGroup для quick timezones (4 опции + «Другой» fallback).
//   - Two-input name row (firstName + lastName) с live preview.
//   - Button primitive с loading state.
//   - Dirty tracking — Save кнопка disabled пока ничего не изменено.

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

export function LearnerProfileCard({
  initialProfile,
  fallbackEmail,
}: {
  initialProfile: AccountProfile | null
  fallbackEmail: string
}) {
  const initialFirstName = initialProfile?.firstName ?? ''
  const initialLastName = initialProfile?.lastName ?? ''
  // Learner surface: null tz defaults to Moscow (legacy behavior).
  const initialTz = safeTimezone(initialProfile?.timezone)

  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [timezone, setTimezone] = useState(initialTz)
  const [otherMode, setOtherMode] = useState(!QUICK_TZ_IDS.has(initialTz))

  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<SaveState>({ kind: 'idle' })

  const previewName = formatProfileNameForRender({
    firstName,
    lastName,
    displayName: initialProfile?.displayName ?? null,
    fallbackEmail,
  })

  const dirty = useMemo(() => {
    if (firstName !== initialFirstName) return true
    if (lastName !== initialLastName) return true
    if (timezone !== initialTz) return true
    return false
  }, [firstName, lastName, timezone, initialFirstName, initialLastName, initialTz])

  const canSave = dirty && !busy

  const chipValue = otherMode || !QUICK_TZ_IDS.has(timezone) ? OTHER_VALUE : timezone
  const chipOptions: ReadonlyArray<ChipOption<string>> = [
    ...QUICK_TIMEZONES,
    { value: OTHER_VALUE, label: 'Другой' },
  ]

  function onChipChange(next: string) {
    if (next === OTHER_VALUE) {
      setOtherMode(true)
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
      aria-labelledby="learner-profile-card-title"
      style={cardStyle}
    >
      <header style={cardHeaderStyle}>
        <h2 id="learner-profile-card-title" style={cardTitleStyle}>
          Имя и часовой пояс
        </h2>
        <p style={cardSubStyle}>
          Это то, что увидит учитель и письма системы. Без имени мы обращаемся
          по адресу{' '}
          <span style={{ color: 'var(--text)' }}>{fallbackEmail}</span>.
        </p>
      </header>

      <div className="lprofile-name-row">
        <FormField label="Имя" htmlFor="lprofile-first">
          <input
            id="lprofile-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Иван"
            maxLength={60}
            autoComplete="given-name"
            style={inputStyle}
          />
        </FormField>
        <FormField label="Фамилия" htmlFor="lprofile-last">
          <input
            id="lprofile-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Петров"
            maxLength={60}
            autoComplete="family-name"
            style={inputStyle}
          />
        </FormField>
      </div>
      <p style={previewLineStyle}>
        Как мы будем к вам обращаться:{' '}
        <span style={{ color: 'var(--text)' }}>{previewName}</span>
      </p>

      <div style={{ marginTop: 20 }}>
        <span style={fieldLabelStyle}>Часовой пояс</span>
        <ChipGroup
          name="lprofile-timezone"
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
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

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

      <div style={actionsRowStyle}>
        <Button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          loading={busy}
        >
          Сохранить
        </Button>
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

const actionsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  marginTop: 20,
}
