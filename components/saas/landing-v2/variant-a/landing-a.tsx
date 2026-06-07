'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { LandingFooter } from '@/components/saas/landing-v2/_shared/landing-footer'
import { LandingMotion } from '@/components/saas/landing-v2/_shared/landing-motion'
import type { LandingLegalProfile } from '@/lib/landing/legal-profile-loader'
import {
  buildClientSessionId,
  recordLandingEvent,
  type LandingSectionId,
} from '@/lib/landing/analytics-events'

import './landing-a.css'

const VARIANT = 'v2-a' as const

export function LandingA({ legalProfile }: { legalProfile: LandingLegalProfile }) {
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

    const sections: Array<{ id: LandingSectionId; selector: string }> = [
      { id: 'act_1_chaos', selector: '.vA-chaos' },
      { id: 'act_4_product', selector: '.vA-product' },
      { id: 'act_5_cta', selector: '.vA-cta' },
    ]

    const observers: IntersectionObserver[] = []
    for (const { id, selector } of sections) {
      const el = document.querySelector(selector)
      if (!el) continue
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              recordLandingEvent({ variantId: VARIANT, sessionId, sectionSeen: id })
              obs.unobserve(e.target)
            }
          }
        },
        { threshold: 0.4 }
      )
      obs.observe(el)
      observers.push(obs)
    }

    return () => observers.forEach((o) => o.disconnect())
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
    <LandingMotion variantId={VARIANT} enableMagnetic enableTilt>
      <div className="vA-content">
        <section className="vA-hero">
          <div className="vA-hero__inner">
            <div className="vA-hero__eyebrow">SaaS для репетитора</div>
            <h1 className="vA-hero__h1">
              Магия.
              <br />
              Стол → кабинет.
              <br />
              Одно нажатие.
            </h1>
            <p className="vA-hero__sub">
              У тебя — шесть сервисов на столе. У нас — один кабинет.
              <br />
              Смотри, как они складываются.
            </p>
          </div>
        </section>

        <section className="vA-chaos" data-scroll-trigger>
          <div className="vA-chaos__inner">
            <h2 className="vA-chaos__h2">
              Каждое занятие — <em>шесть сервисов</em>
              <br />и двенадцать переписок.
            </h2>
            <div className="vA-desk">
              <div className="vA-desk__item vA-desk__item--phone">
                <div className="vA-desk__label">Telegram</div>
                <div className="vA-desk__content">
                  <strong>Анна, можем</strong>
                  перенести занятие на четверг?
                </div>
              </div>
              <div className="vA-desk__item vA-desk__item--stickers">
                <div className="vA-desk__label">Стикер</div>
                <div className="vA-desk__content">Позвонить маме Маши. Петя — оплата.</div>
              </div>
              <div className="vA-desk__item vA-desk__item--notebook">
                <div className="vA-desk__label">Excel</div>
                <div className="vA-desk__content">
                  <strong>Расписание + балансы</strong>
                  20 ячеек. Цвета случайные.
                </div>
              </div>
              <div className="vA-desk__item vA-desk__item--calc">
                <div className="vA-desk__label">Калькулятор</div>
                <div className="vA-desk__content">
                  <strong>14 250 ₽</strong>
                  заработал? или должен?
                </div>
              </div>
              <div className="vA-desk__item vA-desk__item--debts">
                <div className="vA-desk__label">Листок</div>
                <div className="vA-desk__content">
                  Маша — 2<br />Петя — 1<br />Катя — 4
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="vA-product" data-scroll-trigger>
          <div className="vA-product__inner">
            <div className="vA-product__eyebrow">Кульминация</div>
            <h2 className="vA-product__h2">
              Всё. В одном месте.
              <br />
              <em>Бесплатно</em> для первого ученика.
            </h2>
            <p className="vA-product__sub">
              Расписание, ученики, балансы. Один кабинет. Без переписок «когда вам удобно».
            </p>
            <div className="vA-dashboard-mock">
              <div className="vA-dashboard-card" data-tilt>
                <div className="vA-dashboard-card__title">Расписание</div>
                <div className="vA-dashboard-card__rows">
                  <div className="vA-dashboard-card__row">
                    <strong>Анна Смирнова</strong>
                    <span>Чт · 18:00</span>
                  </div>
                  <div className="vA-dashboard-card__row">
                    <strong>Маша Петрова</strong>
                    <span>Пт · 16:00</span>
                  </div>
                  <div className="vA-dashboard-card__row">
                    <strong>Катя Иванова</strong>
                    <span>Пт · 19:30</span>
                  </div>
                </div>
              </div>
              <div className="vA-dashboard-card" data-tilt>
                <div className="vA-dashboard-card__title">Ученики</div>
                <div className="vA-dashboard-card__rows">
                  <div className="vA-dashboard-card__row">
                    <span>Анна</span><span>активна</span>
                  </div>
                  <div className="vA-dashboard-card__row">
                    <span>Маша</span><span>пауза</span>
                  </div>
                  <div className="vA-dashboard-card__row">
                    <span>Катя</span><span>активна</span>
                  </div>
                </div>
              </div>
              <div className="vA-dashboard-card" data-tilt>
                <div className="vA-dashboard-card__title">Балансы</div>
                <div className="vA-dashboard-card__rows">
                  <div className="vA-dashboard-card__row">
                    <span>Анна</span><span className="vA-dashboard-card__amount">+4 200 ₽</span>
                  </div>
                  <div className="vA-dashboard-card__row">
                    <span>Маша</span><span className="vA-dashboard-card__amount">−2 100 ₽</span>
                  </div>
                  <div className="vA-dashboard-card__row">
                    <span>Катя</span><span className="vA-dashboard-card__amount">+8 400 ₽</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="vA-cta" data-scroll-trigger>
          <h2 className="vA-cta__h2">
            Сворачиваем твой стол
            <br />
            <em>в один кабинет.</em>
          </h2>
          <Link
            href="/register?role=teacher&utm_source=landing&utm_medium=v2-a&utm_content=cta_primary"
            className="vA-cta__button"
            data-magnetic
            onClick={handleCtaClick}
          >
            Забрать Стартовый тариф
          </Link>
          <p className="vA-cta__hint">
            Стартовый — навсегда бесплатно. Без карты при регистрации.
            <br />
            <a href="#tariffs">Сколько стоят другие тарифы?</a>
          </p>
        </section>

        <LandingFooter legalProfile={legalProfile} />
      </div>
    </LandingMotion>
  )
}
