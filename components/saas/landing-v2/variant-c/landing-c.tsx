'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { LandingFooter } from '@/components/saas/landing-v2/_shared/landing-footer'
import { LandingMotion } from '@/components/saas/landing-v2/_shared/landing-motion'
import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'
import {
  buildClientSessionId,
  recordLandingEvent,
} from '@/lib/landing/analytics-events'

import './landing-c.css'

const VARIANT = 'v2-c' as const
const STORAGE_KEY = 'saas-v2c-demo-state'

type SlotState = 'booked' | 'pending' | 'free'
type Slot = { row: number; col: number; state: SlotState; label?: string }

type DemoState = {
  calendarSlots: Slot[]
  learners: { id: string; name: string; level: string; balance: number; status: string }[]
  lastInteractedAt?: string
}

const INITIAL_STATE: DemoState = {
  calendarSlots: [
    { row: 0, col: 0, state: 'booked', label: 'Маша · A2' },
    { row: 0, col: 2, state: 'pending', label: 'Аня · B1' },
    { row: 1, col: 1, state: 'booked', label: 'Катя · B2' },
    { row: 1, col: 4, state: 'booked', label: 'Маша · A2' },
    { row: 2, col: 3, state: 'free' },
    { row: 2, col: 5, state: 'pending', label: 'Петя · A1' },
    { row: 3, col: 0, state: 'free' },
    { row: 3, col: 2, state: 'booked', label: 'Аня · B1' },
  ],
  learners: [
    { id: 'l1', name: 'Маша Петрова', level: 'A2 · Pre-Intermediate', balance: -2100, status: 'активна' },
    { id: 'l2', name: 'Анна Смирнова', level: 'B1 · Intermediate', balance: 4200, status: 'активна' },
    { id: 'l3', name: 'Катя Иванова', level: 'B2 · Upper', balance: 8400, status: 'активна' },
    { id: 'l4', name: 'Петя Соколов', level: 'A1 · Elementary', balance: 0, status: 'новый' },
  ],
}

const HOURS = ['16:00', '17:00', '18:00', '19:00']
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function fmt(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString('ru-RU')} ₽`
}

export function LandingC({ legalProfile }: { legalProfile: LandingLegalProfile }) {
  const [state, setState] = useState<DemoState>(INITIAL_STATE)
  const [tab, setTab] = useState<'calendar' | 'learners'>('calendar')

  // localStorage restore (BLOCKER #8 closure: state in browser only, never sent to server)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved) setState(JSON.parse(saved) as DemoState)
    } catch {
      // localStorage may throw in private mode — ignore.
    }
    const sessionId = buildClientSessionId()
    recordLandingEvent({
      variantId: VARIANT,
      sessionId,
      sectionSeen: 'hero',
      conversionStep: 'landing_view',
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    })
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, lastInteractedAt: new Date().toISOString() }))
    } catch {}
  }, [state])

  const cycleSlot = (row: number, col: number) => {
    setState((s) => {
      const existing = s.calendarSlots.find((sl) => sl.row === row && sl.col === col)
      const next: SlotState = existing
        ? existing.state === 'free'
          ? 'pending'
          : existing.state === 'pending'
          ? 'booked'
          : 'free'
        : 'pending'
      const others = s.calendarSlots.filter((sl) => !(sl.row === row && sl.col === col))
      return { ...s, calendarSlots: [...others, { row, col, state: next, label: next === 'free' ? undefined : `Demo · ${next}` }] }
    })
    recordLandingEvent({
      variantId: VARIANT,
      sessionId: buildClientSessionId(),
      sectionSeen: 'demo_try_action',
    })
  }

  const handleCtaClick = (where: 'try' | 'final') => {
    recordLandingEvent({
      variantId: VARIANT,
      sessionId: buildClientSessionId(),
      ctaClicked: where === 'try' ? 'demo_save' : 'register_primary',
      conversionStep: 'cta_click',
    })
  }

  const slotAt = (row: number, col: number): Slot | undefined =>
    state.calendarSlots.find((sl) => sl.row === row && sl.col === col)

  return (
    <LandingMotion variantId={VARIANT}>
      <div className="vC-content">
        <section className="vC-hero">
          <div className="vC-hero__badge">Демо · без регистрации</div>
          <h1 className="vC-hero__h1">
            Попробуй прямо сейчас.
            <br />
            <em>Регистрация — потом.</em>
          </h1>
          <p className="vC-hero__sub">
            Покликай слоты, попробуй карточки. Это интерактивная демонстрация —
            кабинет работает прямо в браузере. Без email, без карты, без обязательств.
          </p>
        </section>

        <section className="vC-dash">
          <div className="vC-dash__inner">
            <div className="vC-dash__topbar">
              <div className="vC-dash__chips">
                <div className="vC-dash__chip" />
                <div className="vC-dash__chip" />
                <div className="vC-dash__chip" />
              </div>
              <span>LevelChannel · кабинет учителя</span>
              <span className="vC-dash__url">demo · /teacher/dashboard</span>
            </div>

            <div className="vC-dash__body">
              <div className="vC-dash__nav">
                <button
                  type="button"
                  className={`vC-dash__navitem ${tab === 'calendar' ? 'is-active' : ''}`}
                  onClick={() => setTab('calendar')}
                >
                  Расписание
                </button>
                <button
                  type="button"
                  className={`vC-dash__navitem ${tab === 'learners' ? 'is-active' : ''}`}
                  onClick={() => setTab('learners')}
                >
                  Ученики
                </button>
                <button type="button" className="vC-dash__navitem" disabled>
                  Балансы
                </button>
                <button type="button" className="vC-dash__navitem" disabled>
                  Пакеты
                </button>
                <button type="button" className="vC-dash__navitem" disabled>
                  Профиль
                </button>
              </div>

              <div className="vC-dash__main">
                {tab === 'calendar' && (
                  <>
                    <h2 className="vC-dash__h2">Расписание · эта неделя</h2>
                    <p className="vC-dash__sub">Кликай по любому слоту — состояние меняется. Это твоё демо.</p>
                    <div className="vC-cal">
                      <div className="vC-cal__head" />
                      {DAYS.map((d) => (
                        <div className="vC-cal__head" key={d}>
                          {d}
                        </div>
                      ))}
                      {HOURS.map((h, row) => (
                        <>
                          <div className="vC-cal__time" key={`time-${row}`}>
                            {h}
                          </div>
                          {DAYS.map((_, col) => {
                            const s = slotAt(row, col)
                            const state = s?.state ?? 'free'
                            return (
                              <button
                                type="button"
                                className="vC-cal__slot"
                                data-state={state}
                                key={`${row}-${col}`}
                                onClick={() => cycleSlot(row, col)}
                              >
                                {s?.label ?? '—'}
                              </button>
                            )
                          })}
                        </>
                      ))}
                    </div>
                  </>
                )}

                {tab === 'learners' && (
                  <>
                    <h2 className="vC-dash__h2">Ученики</h2>
                    <p className="vC-dash__sub">Карточки с балансами и статусами. Демо-данные.</p>
                    <div className="vC-learners">
                      {state.learners.map((l) => (
                        <div className="vC-learner" key={l.id}>
                          <div className="vC-learner__name">
                            {l.name}
                            <span>{l.level}</span>
                          </div>
                          <div
                            className={`vC-learner__bal ${
                              l.balance > 0 ? 'vC-learner__bal--pos' : l.balance < 0 ? 'vC-learner__bal--neg' : ''
                            }`}
                          >
                            {fmt(l.balance)}
                          </div>
                          <div className="vC-learner__status">{l.status}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="vC-try">
                  <div className="vC-try__text">
                    Нравится? Сохрани свой логин для следующего раза.
                    <br />
                    <span>Стартовый — бесплатно. Без email сейчас.</span>
                  </div>
                  <Link
                    href="/register?role=teacher&utm_source=landing&utm_medium=v2-c&utm_content=demo_save"
                    className="vC-try__button"
                    onClick={() => handleCtaClick('try')}
                  >
                    Создать аккаунт
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="vC-bottom">
          <h2 className="vC-bottom__h2">Это твой будущий кабинет.</h2>
          <p className="vC-bottom__sub">
            Демо хранится у тебя в браузере. Регистрация — когда захочешь повторить
            эксперимент с настоящими учениками.
          </p>
          <Link
            href="/register?role=teacher&utm_source=landing&utm_medium=v2-c&utm_content=cta_primary"
            className="vC-bottom__button"
            onClick={() => handleCtaClick('final')}
          >
            Забрать Стартовый тариф
          </Link>
        </section>

        <LandingFooter legalProfile={legalProfile} />
      </div>
    </LandingMotion>
  )
}
