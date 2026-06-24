'use client'

// Epic 7 (2026-06-24) — roving tabIndex + arrow keys для tablist.
// Plan: docs/plans/teacher-payments-design-MASTER-ROADMAP-2026-06-22.md Epic 7.
//
// W3C WAI-ARIA Authoring Practices — tabs pattern:
// https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
//
// Используется в `role="tablist"` контейнере с children `role="tab"`. Hook
// предоставляет `onKeyDown` handler для контейнера; при стрелках Left/Right
// перемещает focus между tab'ами и опционально активирует.
//
// Контракт:
//   - ArrowLeft/Right — focus next/prev tab
//   - Home/End — focus first/last tab
//   - Wraps around (last → first → last)
//   - activateOnFocus=true → onActivate(index) при каждом перемещении
//   - activateOnFocus=false → focus только, требуется Enter/Space для activate

import { useRef, type KeyboardEvent } from 'react'

export type UseTablistKeyboardOptions = {
  /** Активная вкладка (index). */
  activeIndex: number
  /** Сколько вкладок всего. */
  count: number
  /** Колбэк когда меняется активная вкладка. */
  onActivate: (index: number) => void
  /** True (default) — стрелки сразу активируют (auto-activate pattern).
   *  False — стрелки только перемещают focus; Enter/Space activates. */
  activateOnFocus?: boolean
}

export function useTablistKeyboard(options: UseTablistKeyboardOptions) {
  const { activeIndex, count, onActivate, activateOnFocus = true } = options
  const tabRefs = useRef<Array<HTMLElement | null>>([])

  function setTabRef(index: number) {
    return (el: HTMLElement | null) => {
      tabRefs.current[index] = el
    }
  }

  function tabProps(index: number) {
    const isActive = index === activeIndex
    return {
      ref: setTabRef(index),
      // Roving tabIndex: только active вкладка focusable через Tab.
      tabIndex: isActive ? 0 : -1,
      'aria-selected': isActive,
      role: 'tab' as const,
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (count === 0) return
    let nextIndex: number | null = null
    switch (e.key) {
      case 'ArrowLeft':
        nextIndex = activeIndex === 0 ? count - 1 : activeIndex - 1
        break
      case 'ArrowRight':
        nextIndex = activeIndex === count - 1 ? 0 : activeIndex + 1
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = count - 1
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
    tabRefs.current[nextIndex]?.focus()
    if (activateOnFocus) {
      onActivate(nextIndex)
    }
  }

  return { tabProps, onKeyDown }
}
