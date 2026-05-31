'use client'

// SAAS-PIVOT Epic 8 Day 7 (2026-05-22) — teacher-acquisition landing v0.
//
// Plan: docs/plans/saas-pivot-master.md §3 Epic 8 + §5 Day 7.
// Source material: ~/Obsidian/Brain/Research/Level Channel/Competitors/
//   2026-05-20 - Booking SaaS for Tutors - RU CIS Competitive Research.md
//   (§5 landing-teardown gives the 9-block must-have structure; §6 is the
//   differentiation framing; §8 is the GTM rationale used for the
//   social-proof block, which carries NO testimonials by design — there
//   are zero first-party teacher interviews on file as of 2026-05-21).
//
// Replaces the previous learner-targeted landing (the operator-instance
// "Анастасия 1:1 английский" page lived here pre-pivot). Owner decision
// 2026-05-21: SaaS surface is "только для учителей" — the old learner
// content is dropped entirely; learners reach payment via /pay or via a
// teacher-deep-link (`/t/<slug>/pay`, Epic 6 sub-PR #422).
//
// Structure (matches plan §3 Epic 8 + research §5):
//   1. Header (logo + nav + "Войти" + primary CTA to teacher-register)
//   2. Hero (value prop + primary CTA → /register?role=teacher)
//   3. Problem block (the 4 painpoints from research §5.2)
//   4. How it works (3 steps — self-onboard, invite learners, plan-4)
//   5. Features (teacher cabinet snapshot — research §5.5 surface list)
//   6. Pricing (Free CTA, Mid "Скоро", Pro "Запросить ранний доступ",
//      — Mid/Pro CTAs stay disabled/mailto until recurrent flow ships)
//   7. Social proof / trust (research-based framing, NO fake quotes)
//   8. Comparison (vs Excel/Telegram/Calendar — research §5.8)
//   9. Final CTA → /register?role=teacher
//   10. Footer (legal реквизиты + doc links)
//
// Accessibility:
//   - Single <h1> in the hero; sections use <h2>; sub-headings use <h3>.
//   - Decorative SVGs marked aria-hidden="true"; the only <img> uses
//     descriptive alt text.
//   - All CTAs are <a>/<Link> reachable via Tab.
//   - Color contrast uses existing CSS vars (--text / --secondary /
//     --accent-gradient) — WCAG-AA pairings inherit from existing pages.

import React, { useEffect, useState } from 'react'
import Link from 'next/link'

import { BrandMark } from '@/components/brand/brand-mark'
import { BrandMarkAnimated } from '@/components/brand/brand-mark-animated'

type TeacherLandingLegalProfile = {
  legalBankAccount: string
  legalBankBik: string
  legalBankName: string
  legalOperatorDisplay: string
  legalOperatorTaxId: string
  legalOperatorOgrn: string
}

// Two primary CTA destinations (deep-link contract):
//   - REGISTER_HREF deep-links the teacher branch of /register
//     (Day 2 PR #413 activated the ?role=teacher query param).
//   - SUPPORT_EMAIL is the ops contact for Pro plan early-access requests
//     (Mid/Pro public self-serve upgrade is Epic 4-DEFERRED).
const REGISTER_HREF = '/register?role=teacher'
const SUPPORT_EMAIL = 'ops@levelchannel.ru'

function trackEvent(name: string) {
  if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
    ;(window as any).gtag('event', name)
  }
}

function useScrollAnimation() {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const animatedNodes = Array.from(document.querySelectorAll('.fade-in'))
    const revealAll = () => {
      animatedNodes.forEach((node) => node.classList.add('visible'))
    }

    if (typeof IntersectionObserver === 'undefined') {
      revealAll()
      return
    }

    try {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible')
            }
          })
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
      )

      animatedNodes.forEach((node) => observer.observe(node))

      return () => observer.disconnect()
    } catch {
      revealAll()
      return
    }
  }, [])
}

/* ─── PRIMARY CTA ─────────────────────────────────────────────── */
function PrimaryCTA({
  size = 'md',
  label = 'Начать бесплатно',
  className = '',
  href = REGISTER_HREF,
  event = 'landing_cta_register_click',
}: {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  className?: string
  href?: string
  event?: string
}) {
  const sizeClass = size === 'lg' ? 'text-lg py-4 px-8' : ''
  const smStyle: React.CSSProperties =
    size === 'sm'
      ? { fontSize: 15, padding: '7px 16px', minHeight: 'auto', borderRadius: 10 }
      : {}
  return (
    <Link
      href={href}
      className={`btn-primary ${sizeClass} ${className}`}
      style={smStyle}
      onClick={() => trackEvent(event)}
    >
      {label}
    </Link>
  )
}

/* ─── HEADER ─────────────────────────────────────────────── */
function Header() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        transition: 'background 0.3s ease, backdrop-filter 0.3s ease, border-color 0.3s ease',
        background: scrolled ? 'rgba(11,11,12,0.85)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 68,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', color: '#F5F5F7' }}>
          <BrandMark variant="full" width={170} />
        </div>

        <nav
          aria-label="Разделы лендинга"
          style={{ display: 'flex', gap: 32, alignItems: 'center' }}
          className="hidden md:flex"
        >
          {[
            ['Возможности', '#features'],
            ['Цены', '#pricing'],
            ['Чем мы отличаемся', '#comparison'],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              style={{
                color: '#A1A1AA',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#fff')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#A1A1AA')}
            >
              {label}
            </a>
          ))}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link
            href="/login"
            style={{
              color: '#A1A1AA',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#fff')}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#A1A1AA')}
          >
            Войти
          </Link>
          <PrimaryCTA size="sm" label="Начать бесплатно" event="landing_cta_register_click_header" />
        </div>
      </div>
    </header>
  )
}

/* ─── HERO ────────────────────────────────────────────────── */
function Hero() {
  return (
    <section
      className="min-svh"
      style={{
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        paddingTop: 100,
        paddingBottom: 80,
      }}
    >
      {/* Background blobs — decorative. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '10%',
          right: '-10%',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(200,120,120,0.1) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: '0%',
          left: '-5%',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(232,168,144,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div className="container" style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 760 }}>
          {/* Hero brand reveal — SMIL анимация запускается при mount.
              Sub-B.3 C2 Tier-1 polish 2026-05-31. */}
          <div className="hero-brand-reveal" style={{ marginBottom: 28, color: '#F5F5F7' }}>
            <BrandMarkAnimated width={260} ariaLabel="LevelChannel" />
          </div>
          <div className="fade-in">
            <span className="section-label">LevelChannel для преподавателей</span>
          </div>

          <h1
            className="fade-in delay-100"
            style={{
              fontSize: 'clamp(32px, 5vw, 52px)',
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              marginTop: 8,
              marginBottom: 24,
            }}
          >
            Расписание, ученики и балансы —{' '}
            <span className="gradient-text">в одном кабинете</span>, а не в Excel и переписках
          </h1>

          <p
            className="fade-in delay-200"
            style={{
              fontSize: 18,
              color: '#A1A1AA',
              lineHeight: 1.65,
              marginBottom: 32,
              maxWidth: 620,
            }}
          >
            Личный кабинет для репетитора с 1–5 учениками, который растёт вместе с практикой.
            Открывайте слоты, ведите учеников, считайте балансы и пакеты. Ученик сам выбирает время —
            вы освобождаете часы от переписок «когда вам удобно?».
          </p>

          <ul
            className="fade-in delay-300"
            style={{
              listStyle: 'none',
              marginBottom: 40,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {[
              'Самостоятельная регистрация — без долгого онбординга',
              'Ваши тарифы и слоты — без согласований',
              'Бесплатный тариф для первых учеников',
            ].map((item) => (
              <li
                key={item}
                style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16, color: '#E4E4E7' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #C87878, #E8A890)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="#fff"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div
            className="fade-in delay-400"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}
          >
            <PrimaryCTA
              size="lg"
              label="Начать бесплатно"
              event="landing_cta_register_click_hero"
            />
            <a
              href="#how-it-works"
              className="btn-secondary"
              onClick={() => trackEvent('landing_cta_how_it_works_click')}
            >
              Как это работает
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── PROBLEM ─────────────────────────────────────────────── */
function Problem() {
  // Research §5.2 — the 4 explicit teacher painpoints. Framed as
  // statements (not testimonials) so we don't fabricate quotes.
  const pains = [
    {
      title: 'Переписки «когда вам удобно?»',
      desc: 'Согласование времени уходит в Telegram и WhatsApp. Каждый перенос — это ещё пять сообщений.',
    },
    {
      title: 'Забытые оплаты',
      desc: 'Кто оплатил, кто должен, сколько уроков в пакете осталось — всё это держится в голове или в таблице.',
    },
    {
      title: 'Переносы и отмены',
      desc: 'Поздняя отмена за час до урока — и непонятно, считать ли её сгоревшей. Учёт ведётся вручную.',
    },
    {
      title: 'Нет единой истории ученика',
      desc: 'Прогресс, баланс, пакеты, история уроков — в разных местах. У родителя её ещё меньше.',
    },
  ]

  return (
    <section className="section" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Знакомо?</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Преподавать — это про урок, а не про админку
          </h2>
          <p
            style={{
              color: '#A1A1AA',
              fontSize: 17,
              marginTop: 12,
              maxWidth: 560,
              margin: '12px auto 0',
            }}
          >
            Чтобы вести 1–5 первых учеников без хаоса, и спокойно дорасти до 30, нужен один источник
            правды по расписанию, балансам и пакетам.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 20,
          }}
        >
          {pains.map((p, i) => (
            <div
              key={p.title}
              className={`card fade-in delay-${Math.min((i + 1) * 100, 400)}`}
              style={{ padding: '28px 24px' }}
            >
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{p.title}</h3>
              <p style={{ color: '#A1A1AA', fontSize: 14, lineHeight: 1.65 }}>{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── HOW IT WORKS ────────────────────────────────────────── */
function HowItWorks() {
  // Plan §3 Epic 8: "3 steps — self-onboard, invite learners, optional
  // plan-4 для платёжного потока". Plan-4 is the operator-managed plan
  // for teachers who want money to flow through the platform; the
  // default Free plan keeps payments off-platform.
  const steps = [
    {
      n: '01',
      title: 'Зарегистрируйтесь как преподаватель',
      desc:
        'За 2 минуты — без звонка с менеджером. Сразу попадаете в личный кабинет, где можно настроить тарифы и открыть первые слоты.',
    },
    {
      n: '02',
      title: 'Пригласите своих учеников',
      desc:
        'Дайте ссылку-приглашение. Ученик регистрируется, видит ваше расписание, выбирает удобное время и попадает в ваш кабинет.',
    },
    {
      n: '03',
      title: 'Ведите учеников и расписание в кабинете',
      desc:
        'Один источник правды по слотам, балансам и пакетам уроков. Free хватает для одного ученика, а с ростом практики — Mid и Pro. Деньги за уроки приходят к вам напрямую, мимо платформы.',
    },
  ]

  return (
    <section id="how-it-works" className="section">
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Как это работает</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Три шага до первого урока в системе
          </h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 24,
          }}
        >
          {steps.map((s, i) => (
            <div
              key={s.n}
              className={`fade-in delay-${(i + 1) * 100}`}
              style={{ position: 'relative' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  marginBottom: 16,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    background: 'linear-gradient(135deg, #C87878, #E8A890)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    letterSpacing: '0.05em',
                  }}
                >
                  {s.n}
                </span>
                {i < steps.length - 1 && (
                  <div
                    aria-hidden="true"
                    style={{
                      flex: 1,
                      height: 1,
                      background:
                        'linear-gradient(90deg, rgba(200,120,120,0.35), transparent)',
                    }}
                  />
                )}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
              <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.65 }}>{s.desc}</p>
            </div>
          ))}
        </div>

        <div className="fade-in" style={{ textAlign: 'center', marginTop: 48 }}>
          <PrimaryCTA
            size="lg"
            label="Создать кабинет"
            event="landing_cta_register_click_how_it_works"
          />
        </div>
      </div>
    </section>
  )
}

/* ─── FEATURES ────────────────────────────────────────────── */
function Features() {
  // Research §5.5 — teacher cabinet surface list. These are claims that
  // map to shipped surfaces (Epic 1-7); nothing here is aspirational
  // for the MVP cut.
  const items = [
    {
      title: 'Слоты и расписание',
      desc: 'Открывайте свободные слоты, ученик сам бронирует. Один источник правды по часам.',
    },
    {
      title: 'Карточки учеников',
      desc: 'История уроков, баланс, пакеты, статус оплаты — без таблиц на параллельных вкладках.',
    },
    {
      title: 'Пакеты и абонементы',
      desc: 'Пакеты на 4 / 8 уроков, автосписание после проведённого урока, контроль сгоревших уроков.',
    },
    {
      title: 'Балансы и долги',
      desc: 'Видно, кто оплатил, у кого истёк пакет, кому нужно напомнить. Один экран.',
    },
    {
      title: 'Родительский доступ',
      desc: 'Родитель видит расписание ребёнка, статус оплаты и оставшиеся уроки в пакете.',
    },
    {
      title: 'Самозанятый, ИП или физлицо — без разницы',
      desc: 'Налоговый статус Учителя на доступ к кабинету не влияет. Платёжные отношения с учениками вы ведёте сами, привычным способом — мы только организуем расписание и учёт.',
    },
  ]

  return (
    <section id="features" className="section" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Возможности</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Что внутри кабинета преподавателя
          </h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 20,
          }}
        >
          {items.map((f, i) => (
            <div
              key={f.title}
              className={`card fade-in delay-${Math.min((i + 1) * 100, 400)}`}
              style={{ padding: '28px 24px' }}
            >
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{f.title}</h3>
              <p style={{ color: '#A1A1AA', fontSize: 14, lineHeight: 1.65 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── PRICING ─────────────────────────────────────────────── */
function Pricing() {
  // Plan §3 Epic 8 pricing rules:
  //   - Free: «Начать бесплатно» CTA → /register?role=teacher
  //   - Mid (300₽/мес, 5 учеников): «Скоро» — Epic 4-DEFERRED (no public self-serve upgrade in MVP)
  //   - Pro (800₽/мес, 30 учеников): «Запросить ранний доступ» — mailto:ops@levelchannel.ru
  //   (Operator-managed deferred — план-док §8 Update 2026-05-30)
  // The plan ALSO clarifies (§3 Epic 8 + DB seed): operator can manually
  // upgrade a teacher to plan-4 via /admin/teachers/[id]/plan — that's
  // the only paid path live in MVP. Mid/Pro stay "Скоро" until the
  // public self-serve upgrade ships post-MVP.
  const tiers = [
    {
      name: 'Free',
      price: '0 ₽',
      period: 'навсегда',
      limit: 'до 1 ученика',
      bullets: [
        'Расписание и слоты',
        'Карточка ученика',
        'История уроков',
        'Оплата вне платформы',
      ],
      ctaLabel: 'Начать бесплатно',
      ctaHref: REGISTER_HREF,
      ctaEvent: 'landing_cta_register_click_pricing_free',
      ctaKind: 'primary' as const,
      badge: null as string | null,
      highlight: false,
    },
    {
      name: 'Mid',
      price: '300 ₽',
      period: 'в месяц',
      limit: 'до 5 учеников',
      bullets: [
        'Всё из Free',
        'Пакеты и абонементы',
        'Балансы и долги',
        'Родительский доступ',
      ],
      ctaLabel: 'Скоро',
      ctaHref: null,
      ctaEvent: null,
      ctaKind: 'disabled' as const,
      badge: 'Скоро',
      highlight: false,
    },
    {
      name: 'Pro',
      price: '800 ₽',
      period: 'в месяц',
      limit: 'до 30 учеников',
      bullets: [
        'Всё из Mid',
        'Расширенные отчёты',
        'Приоритетная поддержка',
        'Запросить ранний доступ',
      ],
      ctaLabel: 'Запросить ранний доступ',
      ctaHref: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Pro — ранний доступ')}`,
      ctaEvent: 'landing_cta_pro_early_access_click',
      ctaKind: 'secondary' as const,
      badge: 'Ранний доступ',
      highlight: true,
    },
  ]

  return (
    <section id="pricing" className="section">
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Цены</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Простая цена за активных учеников
          </h2>
          <p
            style={{
              color: '#A1A1AA',
              fontSize: 17,
              marginTop: 12,
              maxWidth: 540,
              margin: '12px auto 0',
            }}
          >
            Free — навсегда, для одного ученика. Mid — для первых 5. Pro — когда учеников становится
            больше. Платите только за активных.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 20,
          }}
        >
          {tiers.map((t, i) => (
            <div
              key={t.name}
              className={`card pricing-card fade-in delay-${Math.min((i + 1) * 100, 400)}`}
              style={{
                padding: '28px 24px',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                border: t.highlight
                  ? '1px solid rgba(200,120,120,0.45)'
                  : '1px solid var(--border)',
                background: t.highlight
                  ? 'linear-gradient(145deg, rgba(200,120,120,0.08), rgba(232,168,144,0.04))'
                  : 'var(--surface)',
              }}
            >
              {t.badge && (
                <span
                  className="tag"
                  style={{
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    background: 'rgba(200,120,120,0.18)',
                    color: '#E89A90',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    padding: '4px 10px',
                    borderRadius: 100,
                    border: '1px solid rgba(200,120,120,0.35)',
                  }}
                >
                  {t.badge}
                </span>
              )}

              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t.name}</h3>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <span
                  className="gradient-text"
                  style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em' }}
                >
                  {t.price}
                </span>
                <span style={{ fontSize: 13, color: '#A1A1AA' }}>/{t.period}</span>
              </div>
              <p style={{ fontSize: 13, color: '#A1A1AA', marginBottom: 20 }}>{t.limit}</p>

              <ul
                style={{
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginBottom: 24,
                  flex: 1,
                }}
              >
                {t.bullets.map((b) => (
                  <li
                    key={b}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      fontSize: 13,
                      color: '#E4E4E7',
                      lineHeight: 1.55,
                    }}
                  >
                    <span aria-hidden="true" style={{ color: '#C87878', flexShrink: 0, marginTop: 1 }}>
                      —
                    </span>
                    {b}
                  </li>
                ))}
              </ul>

              {t.ctaKind === 'primary' && t.ctaHref && (
                <Link
                  href={t.ctaHref}
                  className="btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => t.ctaEvent && trackEvent(t.ctaEvent)}
                >
                  {t.ctaLabel}
                </Link>
              )}
              {t.ctaKind === 'secondary' && t.ctaHref && (
                <a
                  href={t.ctaHref}
                  className="btn-secondary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => t.ctaEvent && trackEvent(t.ctaEvent)}
                >
                  {t.ctaLabel}
                </a>
              )}
              {t.ctaKind === 'disabled' && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    opacity: 0.55,
                    cursor: 'not-allowed',
                  }}
                  disabled
                  aria-disabled="true"
                >
                  {t.ctaLabel}
                </button>
              )}
            </div>
          ))}
        </div>

        <p
          className="fade-in"
          style={{
            textAlign: 'center',
            marginTop: 32,
            color: '#71717A',
            fontSize: 13,
            maxWidth: 640,
            margin: '32px auto 0',
            lineHeight: 1.6,
          }}
        >
          Тарифы Mid и Pro — в публичном self-serve пока недоступны. Пишите{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            style={{ color: '#E89A90', textDecoration: 'underline' }}
          >
            {SUPPORT_EMAIL}
          </a>{' '}
          — подключим вручную.
        </p>
      </div>
    </section>
  )
}

/* ─── SOCIAL PROOF / TRUST ─────────────────────────────────── */
function SocialProof() {
  // Research §5.7 — trust framing without fabricated testimonials.
  // Per landing-research inventory (2026-05-21) there are ZERO first-
  // party teacher interviews. Verdict: ship v0 with claim-based trust
  // copy; founder-led 5-8-call sprint will follow, and quotes will land
  // in a v0.1 once consented.
  const claims = [
    {
      title: 'Для преподавателей английского и репетиторов',
      desc:
        'Не CRM для школы и не Calendly. Понимаем уроки, пакеты, переносы и родительский контекст.',
    },
    {
      title: 'Платежи — CloudPayments и СБП',
      desc:
        'Когда деньги идут через платформу, мы используем CloudPayments с фискализацией. Подключает оператор.',
    },
    {
      title: 'Данные учеников и родителей защищены',
      desc:
        '152-ФЗ-комплаенс, шифрование чувствительных полей в БД, аудитный лог операций оператора.',
    },
    {
      title: 'Не заменяет учителя — убирает админку',
      desc:
        'Мы не пишем за вас программу и не ведём уроки. Мы только снимаем переписки, таблицы и забытые оплаты.',
    },
  ]

  return (
    <section className="section">
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Почему нам можно доверять</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Узкая середина: глубже Calendly, легче школьной CRM
          </h2>
          <p
            style={{
              color: '#A1A1AA',
              fontSize: 17,
              marginTop: 12,
              maxWidth: 580,
              margin: '12px auto 0',
            }}
          >
            Мы сознательно не пишем «отзывы клиентов», пока их у нас не запрошено через интервью.
            Первые недели работы платформы — это исследовательская сессия с реальными учителями.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 20,
          }}
        >
          {claims.map((c, i) => (
            <div
              key={c.title}
              className={`card fade-in delay-${Math.min((i + 1) * 100, 400)}`}
              style={{ padding: '24px 22px' }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{c.title}</h3>
              <p style={{ color: '#A1A1AA', fontSize: 14, lineHeight: 1.6 }}>{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── COMPARISON ──────────────────────────────────────────── */
function Comparison() {
  // Research §5.8 — comparison block: vs Excel/Telegram/Calendar/CRM/
  // Calendly. We name only the categories, not specific competitor
  // brands, to keep the page legally clean and durable across pivots.
  const rows = [
    {
      against: 'Excel / Google Sheets',
      gap: 'Нет напоминаний, нет онлайн-записи, нет родительского доступа, всё на ручной поддержке.',
    },
    {
      against: 'Telegram / WhatsApp',
      gap: 'История теряется, переносы — вручную, нет единого баланса ученика.',
    },
    {
      against: 'Google Calendar',
      gap: 'Хорошо для слотов, но нет учеников, пакетов и оплат как сущностей.',
    },
    {
      against: 'CRM для школы',
      gap: 'Слишком тяжело для одного-двух преподавателей: воронки, команда, лидогенерация.',
    },
    {
      against: 'Универсальный Calendly-style сервис',
      gap: 'Хорошая запись, но не понимает уроки, пакеты, переносы и родителей.',
    },
  ]

  return (
    <section id="comparison" className="section" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Чем мы отличаемся</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Не Calendly, не Excel, не школьная CRM
          </h2>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            maxWidth: 760,
            margin: '0 auto',
          }}
        >
          {rows.map((r, i) => (
            <div
              key={r.against}
              className={`card fade-in delay-${Math.min((i + 1) * 100, 400)}`}
              style={{
                padding: '20px 24px',
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1fr) 2fr',
                gap: 20,
                alignItems: 'start',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700 }}>vs {r.against}</div>
              <div style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.65 }}>{r.gap}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── FINAL CTA ───────────────────────────────────────────── */
function FinalCTA() {
  return (
    <section id="cta" className="section">
      <div className="container">
        <div
          className="fade-in final-cta-card"
          style={{
            textAlign: 'center',
            padding: '80px 40px',
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(200,120,120,0.15) 0%, transparent 70%), var(--surface)',
            border: '1px solid rgba(200,120,120,0.18)',
            borderRadius: 28,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: -100,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 400,
              height: 400,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(200,120,120,0.12) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          <span className="section-label" style={{ position: 'relative', zIndex: 1 }}>
            Готовы начать?
          </span>
          <h2
            style={{
              fontSize: 'clamp(28px, 4vw, 44px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 16,
              marginBottom: 16,
              position: 'relative',
              zIndex: 1,
            }}
          >
            Заберите вечер у{' '}
            <span className="gradient-text">переписок и таблиц</span>
          </h2>
          <p
            style={{
              color: '#A1A1AA',
              fontSize: 17,
              marginBottom: 36,
              maxWidth: 520,
              margin: '0 auto 36px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            Регистрация занимает 2 минуты. Не нужно платить и подключать платежи на старте — Free
            тариф работает навсегда.
          </p>
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              justifyContent: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <PrimaryCTA
              size="lg"
              label="Создать кабинет бесплатно"
              event="landing_cta_register_click_final"
            />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── FOOTER ──────────────────────────────────────────────── */
function Footer({ legalProfile }: { legalProfile: TeacherLandingLegalProfile }) {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--border)',
        padding: '48px 0 32px',
      }}
    >
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 40,
            marginBottom: 40,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, color: '#F5F5F7' }}>
              <BrandMark variant="full" width={160} />
            </div>
            <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.65 }}>
              Личный кабинет для преподавателей: расписание, ученики, оплаты.
            </p>
          </div>

          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#fff' }}>
              Реквизиты
            </h3>
            <div style={{ fontSize: 13, color: '#71717A', lineHeight: 2 }}>
              <div>ИП {legalProfile.legalOperatorDisplay}</div>
              <div>ИНН: {legalProfile.legalOperatorTaxId}</div>
              <div>ОГРНИП: {legalProfile.legalOperatorOgrn}</div>
              <div>Р/С: {legalProfile.legalBankAccount}</div>
              <div>Банк: {legalProfile.legalBankName}</div>
              <div>БИК: {legalProfile.legalBankBik}</div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#fff' }}>
              Документы
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Link
                href="/offer"
                style={{
                  fontSize: 14,
                  color: '#A1A1AA',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#fff')}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#A1A1AA')}
              >
                Публичная оферта
              </Link>
              <Link
                href="/privacy"
                style={{
                  fontSize: 14,
                  color: '#A1A1AA',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#fff')}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#A1A1AA')}
              >
                Политика персональных данных
              </Link>
              <Link
                href="/consent/personal-data"
                style={{
                  fontSize: 14,
                  color: '#A1A1AA',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#fff')}
                onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#A1A1AA')}
              >
                Согласие на обработку ПДн
              </Link>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                style={{
                  fontSize: 14,
                  color: '#A1A1AA',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#fff')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#A1A1AA')}
              >
                Написать оператору
              </a>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#fff' }}>
              Для учеников
            </h3>
            <p style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.65 }}>
              Этот лендинг — для преподавателей. Если ваш преподаватель уже работает с
              LevelChannel, попросите ссылку-приглашение или перейдите на страницу оплаты.
            </p>
            <Link
              href="/pay"
              style={{
                fontSize: 14,
                color: '#E89A90',
                textDecoration: 'underline',
                display: 'inline-block',
                marginTop: 8,
              }}
            >
              Перейти к оплате
            </Link>
          </div>
        </div>

        <div className="divider" />
        <div
          style={{
            paddingTop: 24,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <p style={{ fontSize: 13, color: '#52525B' }}>
            © {new Date().getFullYear()} LevelChannel. Все права защищены.
          </p>
          <p style={{ fontSize: 13, color: '#52525B' }}>г. Москва</p>
        </div>
      </div>
    </footer>
  )
}

/* ─── PAGE ────────────────────────────────────────────────── */
export function TeacherLandingClient({
  legalProfile,
}: {
  legalProfile: TeacherLandingLegalProfile
}) {
  useScrollAnimation()

  useEffect(() => {
    trackEvent('landing_view')
  }, [])

  return (
    <>
      <Header />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <Pricing />
        <SocialProof />
        <Comparison />
        <FinalCTA />
      </main>
      <Footer legalProfile={legalProfile} />
    </>
  )
}
