'use client'

// Epic C — карточка с приватной учительской заметкой о ученике (2026-06-18).
//
// Plan: docs/plans/clever-sprouting-floyd.md Epic C.
//
// View / edit toggle, autosize textarea с counter «N / 2000», явные кнопки
// «Отмена» + «Сохранить». PATCH /api/teacher/learners/{id}/note. Optimistic
// UX: на 200 локально обновляем; на ошибку показываем строку и не теряем
// текст в textarea.

import { useState } from 'react'

// Inline-копия MAX_TEACHER_NOTE_LENGTH из lib/learners/teacher-note.ts:
// server-helper тянет pg → bundle ломается на 'fs/dns/net' если client
// component импортит из server-side модуля. SoT — DB CHECK constraint
// (mig 0137) + лимит дублируется в API guard'е. Drift невозможен:
// тест pin'ит обе константы (см. teacher-note.test.ts).
const MAX_TEACHER_NOTE_LENGTH = 2000

type Props = {
  learnerId: string
  initialNote: string | null
}

const SECTION_STYLE: React.CSSProperties = {
  padding: 16,
  background: 'var(--surface-1)',
  borderRadius: 12,
  marginBottom: 24,
  border: '1px solid var(--border)',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 10,
}

const LABEL_TEXT_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--secondary)',
  fontWeight: 500,
}

const PRIV_STYLE: React.CSSProperties = {
  color: 'var(--text-tertiary, var(--secondary))',
  marginLeft: 4,
  fontWeight: 400,
}

const EDIT_LINK_STYLE: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: 'var(--accent)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

const NOTE_BODY_STYLE: React.CSSProperties = {
  background: 'var(--surface-2, rgba(255,255,255,0.04))',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 14,
  fontSize: 14,
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
  lineHeight: 1.6,
}

const NOTE_EMPTY_STYLE: React.CSSProperties = {
  color: 'var(--text-tertiary, var(--secondary))',
  padding: 16,
  textAlign: 'center',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.5,
}

const TEXTAREA_STYLE: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-2, rgba(255,255,255,0.04))',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: 14,
  borderRadius: 10,
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: 1.6,
  resize: 'vertical',
  minHeight: 140,
  outline: 'none',
}

const COUNTER_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 12,
  color: 'var(--text-tertiary, var(--secondary))',
  marginTop: 6,
}

const ACTIONS_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 12,
  justifyContent: 'flex-end',
}

const BTN_STYLE: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  border: 0,
  cursor: 'pointer',
}

const BTN_PRIMARY_STYLE: React.CSSProperties = {
  ...BTN_STYLE,
  background: 'var(--accent)',
  color: '#1a1a1a',
}

const BTN_GHOST_STYLE: React.CSSProperties = {
  ...BTN_STYLE,
  background: 'transparent',
  color: 'var(--secondary)',
  border: '1px solid var(--border)',
}

const ERROR_STYLE: React.CSSProperties = {
  color: 'var(--danger)',
  fontSize: 13,
  marginTop: 8,
}

export function LearnerNoteCard({ learnerId, initialNote }: Props) {
  const [note, setNote] = useState<string | null>(initialNote)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialNote ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = () => {
    setDraft(note ?? '')
    setError(null)
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setError(null)
  }

  const save = async () => {
    setError(null)
    setBusy(true)
    try {
      const trimmed = draft.trim()
      const res = await fetch(`/api/teacher/learners/${learnerId}/note`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: trimmed.length === 0 ? null : trimmed }),
      })
      const data = (await res.json()) as
        | { ok: true; note: string | null }
        | { error: string; message?: string }
      if (!res.ok) {
        const err = data as { error: string; message?: string }
        setError(err.message ?? `Ошибка: ${err.error}`)
        return
      }
      const ok = data as { ok: true; note: string | null }
      setNote(ok.note)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить заметку.')
    } finally {
      setBusy(false)
    }
  }

  const isEmpty = (note ?? '').trim().length === 0

  return (
    <section
      data-testid="learner-note-card"
      style={SECTION_STYLE}
      aria-label="Заметка о ученике"
    >
      <div style={LABEL_STYLE}>
        <span style={LABEL_TEXT_STYLE}>
          Заметка
          <span style={PRIV_STYLE}>— только вы видите</span>
        </span>
        {!editing ? (
          <button
            type="button"
            style={EDIT_LINK_STYLE}
            onClick={startEdit}
            data-testid="learner-note-edit-btn"
          >
            {isEmpty ? '＋ Добавить' : '✎ Редактировать'}
          </button>
        ) : null}
      </div>

      {!editing ? (
        isEmpty ? (
          <div style={NOTE_EMPTY_STYLE} data-testid="learner-note-empty">
            Здесь будет ваша приватная заметка о ученике. Она поможет вспомнить контекст перед уроком.
          </div>
        ) : (
          <div style={NOTE_BODY_STYLE} data-testid="learner-note-body">
            {note}
          </div>
        )
      ) : (
        <>
          <textarea
            data-testid="learner-note-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_TEACHER_NOTE_LENGTH}
            disabled={busy}
            style={TEXTAREA_STYLE}
            placeholder="Например: готовится к ЕГЭ. Слабая алгебра. Звонит мама — Татьяна, после 19:00."
            aria-label="Заметка о ученике"
          />
          <div style={COUNTER_ROW_STYLE}>
            <span>До {MAX_TEACHER_NOTE_LENGTH} символов</span>
            <span data-testid="learner-note-counter">
              {draft.length} / {MAX_TEACHER_NOTE_LENGTH}
            </span>
          </div>
          {error ? <p style={ERROR_STYLE}>{error}</p> : null}
          <div style={ACTIONS_STYLE}>
            <button
              type="button"
              style={BTN_GHOST_STYLE}
              onClick={cancel}
              disabled={busy}
              data-testid="learner-note-cancel-btn"
            >
              Отмена
            </button>
            <button
              type="button"
              style={BTN_PRIMARY_STYLE}
              onClick={save}
              disabled={busy}
              data-testid="learner-note-save-btn"
            >
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
