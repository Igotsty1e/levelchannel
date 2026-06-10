'use client'

import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { normalizeForSearch } from '@/lib/text/normalize'

// Combobox primitive. Used by LearnerPicker, PackagePicker, TariffPicker.
//
// Two render modes (via window.matchMedia('(min-width: 600px)')):
//   - mobile: tap opens a full-screen bottom-sheet (search input + list)
//   - desktop: click opens an inline dropdown under the trigger
//
// Keyboard: ↑/↓ navigate, Home/End jump, Enter selects, Esc closes.
// Type-ahead search filters options client-side using `normalizeForSearch`
// (handles ё/й diacritics common in Russian names).
//
// History: open pushes a placeholder state so the system back gesture
// (iOS/Android) closes the sheet first instead of unwinding the parent
// route. Mirrors the modal pattern used in BulkAddSlotsModal.
//
// Scale assumption: ≤50 options. All filtering is client-side; no
// server-side search.

export type ComboboxOption = {
  value: string
  label: string
  sub?: string
}

export type ComboboxProps = {
  value: string | null
  onChange: (next: string) => void
  options: ReadonlyArray<ComboboxOption>
  placeholder?: string
  emptyMessage?: string
  loading?: boolean
  errorMessage?: string | null
  disabled?: boolean
  size?: 'sm' | 'md'
  /**
   * Show the search-by-text input above the list. Default `true` —
   * kept for backwards compat with existing callers. When `false`,
   * the list renders as a plain «select from these» picker: no
   * input, focus jumps straight to the active option on open. Use
   * this when the option set is short (≤30) and obviously
   * scannable.
   */
  searchable?: boolean
  /**
   * Custom trigger render. Receives the props it must spread on a
   * focusable element. Defaults to an internal chip-style button.
   */
  renderTrigger?: (props: {
    onClick: () => void
    'aria-expanded': boolean
    'aria-controls': string
    'aria-haspopup': 'listbox'
    'aria-disabled'?: boolean
    ref: React.RefObject<HTMLButtonElement | null>
  }) => ReactNode
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Выберите',
  emptyMessage = 'Ничего не найдено',
  loading,
  errorMessage,
  disabled,
  size = 'md',
  renderTrigger,
  searchable = true,
}: ComboboxProps) {
  const [isDesktop, setIsDesktop] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const listboxId = useId()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(min-width: 600px)')
    const sync = () => setIsDesktop(mql.matches)
    sync()
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [])

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  )

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options
    const needle = normalizeForSearch(query)
    return options.filter((o) => {
      const hay = normalizeForSearch(`${o.label} ${o.sub ?? ''}`)
      return hay.includes(needle)
    })
  }, [options, query])

  // ---------------------------------------------------------------------
  // open / close lifecycle
  // ---------------------------------------------------------------------

  const closePanel = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
    triggerRef.current?.focus()
  }, [])

  const openPanel = useCallback(() => {
    if (disabled) return
    setOpen(true)
    setActiveIndex(selectedOption ? options.indexOf(selectedOption) : -1)
  }, [disabled, options, selectedOption])

  // Note: Combobox does NOT push a history entry on open. Pushing one
  // created a tangle when nested inside a parent modal that already
  // pushed its own entry: closing the Combobox via an option-click
  // popped the history, which fired `popstate` on the parent modal's
  // listener and closed it before the option's onChange could fire.
  // The parent modal owns the back-button contract; Combobox just
  // closes via tap-outside / Esc / option click.

  // Autofocus on open. With the search input rendered → focus it
  // so the teacher can immediately start typing. Without it → focus
  // the list container so arrow keys work right away.
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      if (searchable) {
        searchRef.current?.focus()
      } else {
        listRef.current?.focus()
      }
    }, 30)
    return () => window.clearTimeout(id)
  }, [open, searchable])

  // ---------------------------------------------------------------------
  // keyboard handling
  // ---------------------------------------------------------------------

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!open) return
    if (e.key === 'Escape') {
      e.stopPropagation() // do not close parent modal
      e.preventDefault()
      closePanel()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(filteredOptions.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(filteredOptions.length - 1)
      return
    }
    if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      const picked = filteredOptions[activeIndex]
      if (picked) {
        onChange(picked.value)
        closePanel()
      }
    }
  }

  // ---------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------

  const triggerLabel = selectedOption?.label ?? placeholder
  const triggerSize = size === 'sm' ? sizeSm : sizeMd

  const triggerProps = {
    onClick: openPanel,
    'aria-expanded': open,
    'aria-controls': listboxId,
    'aria-haspopup': 'listbox' as const,
    'aria-disabled': disabled,
    ref: triggerRef,
  }

  const Trigger = renderTrigger ? (
    renderTrigger(triggerProps)
  ) : (
    <button
      {...triggerProps}
      type="button"
      disabled={disabled}
      style={{
        ...triggerSize,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        border: '1px solid var(--border)',
        background: 'var(--bg)',
        borderRadius: 8,
        color: selectedOption ? 'var(--text)' : 'var(--secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        minWidth: 0,
        width: '100%',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {triggerLabel}
      </span>
      <span aria-hidden="true" style={{ color: 'var(--secondary)', fontSize: 12 }}>
        ▾
      </span>
    </button>
  )

  return (
    <>
      {Trigger}
      {open ? (
        <div
          role="presentation"
          onKeyDown={handleKeyDown}
          style={isDesktop ? desktopWrapperStyle : mobileOverlayStyle}
          onClick={isDesktop ? undefined : closePanel}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={
              isDesktop
                ? desktopPanelStyle(triggerRef.current?.getBoundingClientRect())
                : mobileSheetStyle
            }
          >
            {!isDesktop ? (
              <div
                aria-hidden="true"
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 999,
                  background: 'var(--border)',
                  margin: '0 auto 8px',
                }}
              />
            ) : null}
            {searchable ? (
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIndex(filteredOptions.length > 0 ? 0 : -1)
                }}
                placeholder="Поиск"
                aria-label="Поиск по списку"
                style={searchInputStyle}
              />
            ) : null}
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              tabIndex={searchable ? undefined : -1}
              aria-label={placeholder}
              style={listStyle(isDesktop)}
            >
              {loading ? (
                <li style={messageStyle}>Загрузка…</li>
              ) : errorMessage ? (
                <li style={{ ...messageStyle, color: 'var(--danger, #ff6e6e)' }}>
                  {errorMessage}
                </li>
              ) : filteredOptions.length === 0 ? (
                <li style={messageStyle}>{emptyMessage}</li>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const isActive = idx === activeIndex
                  const isSelected = opt.value === value
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => {
                        onChange(opt.value)
                        closePanel()
                      }}
                      style={{
                        ...optionStyle,
                        background: isActive
                          ? 'var(--accent-bg, rgba(216,138,130,0.10))'
                          : 'transparent',
                        borderColor: isSelected
                          ? 'var(--accent, #D88A82)'
                          : 'transparent',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{opt.label}</div>
                      {opt.sub ? (
                        <div style={{ fontSize: 12, color: 'var(--secondary)' }}>
                          {opt.sub}
                        </div>
                      ) : null}
                    </li>
                  )
                })
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------

const sizeMd: CSSProperties = { padding: '10px 12px', fontSize: 14, minHeight: 44 }
const sizeSm: CSSProperties = { padding: '8px 10px', fontSize: 13, minHeight: 36 }

const mobileOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 1200,
}

const mobileSheetStyle: CSSProperties = {
  width: '100%',
  maxWidth: 480,
  minHeight: 200,
  maxHeight: '70vh',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  padding: '14px 12px calc(14px + env(safe-area-inset-bottom))',
  color: 'var(--text)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

function desktopPanelStyle(
  triggerRect: DOMRect | undefined,
): CSSProperties {
  const top = triggerRect ? triggerRect.bottom + 4 : 0
  const left = triggerRect ? triggerRect.left : 0
  const width = triggerRect ? Math.max(triggerRect.width, 240) : 240
  return {
    position: 'fixed',
    top,
    left,
    width,
    maxHeight: 360,
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    padding: 8,
    color: 'var(--text)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    zIndex: 1200,
  }
}

const desktopWrapperStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  pointerEvents: 'auto',
}

const searchInputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
}

function listStyle(isDesktop: boolean): CSSProperties {
  return {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    overflowY: 'auto',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: isDesktop ? 280 : undefined,
  }
}

const optionStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid transparent',
  cursor: 'pointer',
  minHeight: 44,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
}

const messageStyle: CSSProperties = {
  padding: '12px 10px',
  fontSize: 13,
  color: 'var(--secondary)',
  textAlign: 'center',
}
