'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { LandingFooter } from '@/components/saas/landing-v2/_shared/landing-footer'
import { LandingMotion } from '@/components/saas/landing-v2/_shared/landing-motion'
import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'
import {
  buildClientSessionId,
  recordLandingEvent,
} from '@/lib/landing/analytics-events'

import './landing-b.css'

const VARIANT = 'v2-b' as const

export function LandingB({ legalProfile }: { legalProfile: LandingLegalProfile }) {
  useEffect(() => {
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

  const handleCtaClick = () => {
    recordLandingEvent({
      variantId: VARIANT,
      sessionId: buildClientSessionId(),
      ctaClicked: 'register_primary',
      conversionStep: 'cta_click',
    })
  }

  return (
    <LandingMotion variantId={VARIANT}>
      <div className="vB-content">
        <section className="vB-hero">
          <div className="vB-hero__inner">
            <div className="vB-hero__kicker">Эссе для репетитора</div>
            <h1 className="vB-hero__h1">
              Преподавать —<br />
              <em>твоё призвание.</em>
              <br />
              Управлять —<br />
              наше.
            </h1>
            <p className="vB-hero__lede">
              Расписание, ученики, балансы. Никаких шести сервисов и двенадцати переписок.
              Один кабинет, чистый и понятный, навсегда твой.
            </p>
          </div>
        </section>

        <div className="vB-rule" />

        <section className="vB-editorial" data-scroll-trigger>
          <div className="vB-editorial__inner">
            <div className="vB-editorial__num">
              <span>01</span>
              Расписание
            </div>
            <div className="vB-editorial__body">
              <h2 className="vB-editorial__h2">
                Когда у тебя <em>тридцать учеников,</em> ты не помнишь, кто на завтра.
              </h2>
              <p className="vB-editorial__p">
                Excel-таблица скажет — у Маши вторник 16:00, у Пети четверг 18:30,
                у Ани субботняя пара. Но Excel не подскажет, что Аня на прошлой неделе
                написала «давай перенесём на пятницу», а ты забыл сдвинуть строчку.
              </p>
              <p className="vB-editorial__p">
                Расписание в LevelChannel — это не таблица. Это календарь, который видишь
                ты и видит ученик. Перенос — две секунды. История — наглядна. Конфликтов нет.
              </p>
              <div className="vB-inline-cta">
                <Link
                  href="/register?role=teacher&utm_source=landing&utm_medium=v2-b&utm_content=inline_schedule"
                  onClick={handleCtaClick}
                >
                  Попробовать → расписание из коробки
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="vB-rule" />

        <section className="vB-editorial" data-scroll-trigger>
          <div className="vB-editorial__inner">
            <div className="vB-editorial__num">
              <span>02</span>
              Балансы
            </div>
            <div className="vB-editorial__body">
              <h2 className="vB-editorial__h2">
                «Сколько ты вообще заработал в этом месяце?» — <em>точно ответить — невозможно.</em>
              </h2>
              <p className="vB-editorial__p">
                Часть переводов — на карту, часть — наличкой после занятия, часть — родители
                оплачивают сразу пакетом за четыре занятия вперёд. Через три месяца не помнишь,
                кто оплатил, кто должен, и сколько уже не вернёшь, потому что забыл.
              </p>
              <div className="vB-editorial__pullquote">
                Баланс — это не цифра в калькуляторе. Это спокойствие, что ты не теряешь
                деньги, потому что забыл записать.
              </div>
              <p className="vB-editorial__p">
                LevelChannel ведёт баланс каждого ученика автоматически. Поставил занятие —
                списалось с пакета. Пришла оплата — пополнился счёт. Видишь сразу: Маша
                должна за два урока, у Пети ещё четыре в пакете.
              </p>
              <div className="vB-inline-cta">
                <Link
                  href="/register?role=teacher&utm_source=landing&utm_medium=v2-b&utm_content=inline_balances"
                  onClick={handleCtaClick}
                >
                  Попробовать → балансы из коробки
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="vB-rule" />

        <section className="vB-editorial" data-scroll-trigger>
          <div className="vB-editorial__inner">
            <div className="vB-editorial__num">
              <span>03</span>
              Ученики
            </div>
            <div className="vB-editorial__body">
              <h2 className="vB-editorial__h2">
                Карточка ученика — там всё, что <em>ты обещал помнить.</em>
              </h2>
              <p className="vB-editorial__p">
                Уровень. Цели на семестр. Особенности — «слабая фонетика», «любит письма»,
                «жалуется на грамматику». Прошлое занятие — что разбирали. Дом. задание — что
                задал. Сегодня — что готовить.
              </p>
              <p className="vB-editorial__p">
                Не в голове. Не в стикерах на мониторе. В одном месте, где ты увидишь это
                за десять секунд до звонка.
              </p>
              <div className="vB-inline-cta">
                <Link
                  href="/register?role=teacher&utm_source=landing&utm_medium=v2-b&utm_content=inline_learners"
                  onClick={handleCtaClick}
                >
                  Попробовать → карточки учеников
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="vB-rule" />

        <section className="vB-final-cta" data-scroll-trigger>
          <h2 className="vB-final-cta__h2">
            Расписание. Ученики. Балансы.
            <br />
            <em>Навсегда твоё.</em>
          </h2>
          <p className="vB-final-cta__sub">
            Стартовый тариф — навсегда бесплатно для первого ученика. Без карты при
            регистрации. Без вопросов «зачем тебе ещё одна программа».
          </p>
          <Link
            href="/register?role=teacher&utm_source=landing&utm_medium=v2-b&utm_content=cta_primary"
            className="vB-final-cta__button"
            onClick={handleCtaClick}
          >
            Забрать Стартовый тариф
          </Link>
          <p className="vB-final-cta__sig">
            — Команда LevelChannel.
          </p>
        </section>

        <LandingFooter legalProfile={legalProfile} />
      </div>
    </LandingMotion>
  )
}
