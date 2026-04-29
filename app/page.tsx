'use client'

import React, { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'


const TELEGRAM_URL = 'https://t.me/anastasiia_englishcoach'

function trackEvent(name: string) {
  if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
    ;(window as any).gtag('event', name)
  }
}

function TelegramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 1 0 24 12 12 12 0 0 0 11.944 0Zm5.916 8.1-2.09 9.851c-.158.699-.571.869-1.157.54l-3.2-2.358-1.544 1.487c-.171.171-.315.315-.646.315l.231-3.272 5.945-5.372c.258-.229-.056-.357-.4-.128L7.9 14.6l-3.134-.977c-.682-.213-.696-.682.142-.01l8.16-3.147c.568-.205 1.067.138.882.634Z" />
    </svg>
  )
}

function CTAButton({
  className = '',
  size = 'md',
  label = 'Написать в Telegram',
}: {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  label?: string
}) {
  const sizeClass = size === 'lg' ? 'text-lg py-4 px-8' : ''
  const smStyle: React.CSSProperties = size === 'sm'
    ? { fontSize: 15, padding: '7px 16px', minHeight: 'auto', borderRadius: 10 }
    : {}
  return (
    <a
      href={TELEGRAM_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`btn-primary ${sizeClass} ${className}`}
      style={smStyle}
      onClick={() => trackEvent('telegram_click')}
    >
      <TelegramIcon size={size === 'lg' ? 22 : 18} />
      {label}
    </a>
  )
}

function useScrollAnimation() {
  useEffect(() => {
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
    document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

function useScrollDepth() {
  useEffect(() => {
    let fired50 = false
    let fired90 = false
    function onScroll() {
      const depth =
        ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100
      if (!fired50 && depth >= 50) {
        fired50 = true
        trackEvent('scroll_50')
      }
      if (!fired90 && depth >= 90) {
        fired90 = true
        trackEvent('scroll_90')
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
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
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 68 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 32,
              fontWeight: 900,
              fontStyle: 'italic',
              lineHeight: 1,
              background: 'linear-gradient(135deg, #C87878 0%, #E8A890 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '-0.04em',
              flexShrink: 0,
            }}
          >
            L
          </span>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>
            evel<span className="gradient-text">Channel</span>
          </span>
        </div>

        {/* Desktop nav */}
        <nav style={{ display: 'flex', gap: 32, alignItems: 'center' }} className="hidden md:flex">
          {[
            ['Форматы', '#usecases'],
            ['Результаты', '#results'],
            ['Обо мне', '#teacher'],
            ['Цены', '#pricing'],
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
          <CTAButton size="sm" />
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
      {/* Background blobs */}
      <div
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
        <div style={{ maxWidth: 720 }}>
          <div className="fade-in">
            <span className="section-label">Индивидуальный формат 1:1</span>
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
            Английский под вашу цель —{' '}
            <span className="gradient-text">от экзамена до работы</span>{' '}
            с иностранными клиентами
          </h1>

          <ul
            className="fade-in delay-300"
            style={{ listStyle: 'none', marginBottom: 40, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {[
              'Подготовка к IELTS и экзаменам',
              'Английский для работы и карьеры',
              'Разговорный английский с нуля до уверенности',
            ].map((item) => (
              <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16, color: '#E4E4E7' }}>
                <span
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
                    <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className="fade-in delay-400" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <CTAButton size="lg" />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── TRUST STATS ─────────────────────────────────────────── */
function TrustStats() {
  const stats = [
    { number: '8', label: 'лет', desc: 'преподавания' },
    { number: '10 000+', label: 'часов', desc: 'практики' },
    { number: '1:1', label: 'формат', desc: 'только индивидуально' },
    { number: '∞', label: 'мотивации', desc: 'для каждого' },
  ]

  return (
    <div style={{ paddingBottom: 80 }}>
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 1,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 16,
            overflow: 'hidden',
            marginTop: 0,
          }}
        >
          {stats.map((s, i) => (
            <div
              key={i}
              className="fade-in"
              style={{
                background: 'var(--surface)',
                padding: '36px 28px',
                textAlign: 'center',
                transitionDelay: `${i * 0.1}s`,
              }}
            >
              <div className="stat-number">{s.number}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginTop: 6 }}>{s.label}</div>
              <div style={{ fontSize: 13, color: '#A1A1AA', marginTop: 4 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─── USE CASES ───────────────────────────────────────────── */
function UseCases() {
  const cases = [
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
          <path d="M6 12v5c3 3 9 3 12 0v-5" />
        </svg>
      ),
      title: 'Экзамены',
      subtitle: 'IELTS, TOEIC, ОГЭ и другие',
      desc: 'Системная подготовка к международным экзаменам. Работаем с каждым аспектом: listening, reading, writing, speaking.',
      tags: ['IELTS', 'TOEIC', 'ОГЭ'],
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          <line x1="12" y1="12" x2="12" y2="16" />
          <line x1="10" y1="14" x2="14" y2="14" />
        </svg>
      ),
      title: 'Работа',
      subtitle: 'Бизнес и карьера',
      desc: 'Английский для переговоров, писем, презентаций и работы в международной среде. Специфика вашей сферы.',
      tags: ['IT', 'Бизнес', 'Переговоры'],
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      title: 'Разговорный',
      subtitle: 'Свободная речь',
      desc: 'Преодолеем языковой барьер и выстроим уверенность в общении. Фокус на живом языке и реальных ситуациях.',
      tags: ['Общение', 'Путешествия', 'Нетворкинг'],
    },
  ]

  return (
    <section id="usecases" className="section">
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Форматы занятий</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Для чего вам английский язык?
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 17, marginTop: 12, maxWidth: 480, margin: '12px auto 0' }}>
            Выберите направление — составим программу под вас
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {cases.map((c, i) => (
            <div
              key={c.title}
              className={`card fade-in delay-${(i + 1) * 100}`}
              style={{ padding: '32px 28px' }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'rgba(200,120,120,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#E89A90',
                  marginBottom: 20,
                }}
              >
                {c.icon}
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{c.title}</h3>
              <div style={{ fontSize: 13, color: '#E89A90', fontWeight: 500, marginBottom: 12 }}>{c.subtitle}</div>
              <p style={{ color: '#A1A1AA', fontSize: 15, lineHeight: 1.65, marginBottom: 20 }}>{c.desc}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {c.tags.map((t) => (
                  <span key={t} className="tag">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── PROCESS ─────────────────────────────────────────────── */
function Process() {
  const steps = [
    {
      n: '01',
      title: 'Определение цели',
      desc: 'Обсуждаем вашу ситуацию, уровень и конкретную цель. Диагностируем слабые места.',
    },
    {
      n: '02',
      title: 'Индивидуальный план',
      desc: 'Составляю программу именно под вас — с учётом целей, темпа и формата.',
    },
    {
      n: '03',
      title: 'Занятия 1:1',
      desc: 'Регулярные занятия один на один. Только ваши вопросы, ваш прогресс, ваш темп.',
    },
    {
      n: '04',
      title: 'ДЗ + обратная связь',
      desc: 'Домашние задания между занятиями и детальная обратная связь по каждому.',
    },
  ]

  return (
    <section className="section" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Как мы работаем</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Процесс обучения
          </h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 24,
            position: 'relative',
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
                    style={{
                      flex: 1,
                      height: 1,
                      background: 'linear-gradient(90deg, rgba(200,120,120,0.35), transparent)',
                    }}
                  />
                )}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
              <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.65 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── RESULTS ─────────────────────────────────────────────── */
function Results() {
  const results = [
    {
      before: 'IELTS 4.5',
      after: 'IELTS 6.5',
      tag: '10 месяцев',
      bullets: ['2 занятия в неделю', 'Цель: поступление в университет', 'Успешно сдала входной экзамен'],
      icon: '📈',
    },
    {
      before: 'Нет подготовки',
      after: 'Сертификат с целевым баллом',
      tag: 'Экзамен',
      bullets: ['Интенсив 3–4 раза в неделю', 'Подготовка за 6 недель', 'Получила сертификат'],
      icon: '⚡',
    },
    {
      before: 'B2',
      after: 'Оффер в международную компанию',
      tag: 'Карьера',
      bullets: ['4 месяца — уверенные интервью', 'Оффер через 6 месяцев', 'Деловой английский'],
      icon: '💼',
    },
    {
      before: 'Понимал, но не говорил',
      after: 'Свободное общение',
      tag: 'Разговорный',
      bullets: ['За 3 месяца — бытовые темы', 'Преодолён языковой барьер', 'Уверенность в речи'],
      icon: '🗣️',
    },
    {
      before: 'B1',
      after: 'B2 за год',
      tag: 'Нетворкинг',
      bullets: ['Бизнес-среда на английском', 'Новая сеть контактов', 'Полезные знакомства'],
      icon: '🌐',
    },
  ]

  return (
    <section id="results" className="section">
      <div className="container">
        <div className="fade-in" style={{ textAlign: 'center', marginBottom: 56 }}>
          <span className="section-label">Результаты учеников</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 12,
            }}
          >
            Реальные истории — реальный прогресс
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 17, marginTop: 12 }}>
            Измеримые результаты, которые меняют жизнь
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            marginBottom: 48,
          }}
        >
          {results.map((r, i) => (
            <div
              key={i}
              className={`card fade-in`}
              style={{ padding: '28px', transitionDelay: `${i * 0.08}s` }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 28 }}>{r.icon}</span>
                <span className="tag">{r.tag}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: '#A1A1AA',
                    textDecoration: 'line-through',
                    textDecorationColor: 'rgba(161,161,170,0.5)',
                  }}
                >
                  {r.before}
                </span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="#C87878" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #C87878, #E8A890)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  {r.after}
                </span>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {r.bullets.map((b) => (
                  <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#A1A1AA', lineHeight: 1.5 }}>
                    <span style={{ color: '#C87878', flexShrink: 0, marginTop: 2 }}>—</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="fade-in" style={{ textAlign: 'center' }}>
          <CTAButton
            size="lg"
            label="Хочу такой же результат"
          />
        </div>
      </div>
    </section>
  )
}

/* ─── TEACHER ─────────────────────────────────────────────── */
function Teacher() {
  return (
    <section id="teacher" className="section" style={{ background: 'rgba(255,255,255,0.015)' }}>
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 60,
            alignItems: 'center',
          }}
        >
          {/* Photo */}
          <div className="fade-in" style={{ position: 'relative' }}>
            <div
              style={{
                borderRadius: 24,
                overflow: 'hidden',
                position: 'relative',
                aspectRatio: '4/5',
                maxWidth: 420,
                margin: '0 auto',
              }}
            >
              {/* Gradient border glow */}
              <div
                style={{
                  position: 'absolute',
                  inset: -2,
                  borderRadius: 26,
                  background: 'linear-gradient(135deg, rgba(200,120,120,0.5), rgba(59,130,246,0.6))',
                  zIndex: 0,
                }}
              />
              <div
                style={{
                  position: 'relative',
                  zIndex: 1,
                  borderRadius: 22,
                  overflow: 'hidden',
                  height: '100%',
                  margin: 2,
                }}
              >
                <Image
                  src="/anastasia.jpg"
                  alt="Анастасия — преподаватель английского языка"
                  fill
                  style={{ objectFit: 'cover', objectPosition: 'top center' }}
                  priority
                />
              </div>
            </div>
          </div>

          {/* Info */}
          <div>
            <div className="fade-in">
              <span className="section-label">Ваш преподаватель</span>
            </div>

            <h2
              className="fade-in delay-100"
              style={{
                fontSize: 'clamp(28px, 3.5vw, 40px)',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                marginTop: 12,
                marginBottom: 8,
              }}
            >
              Анастасия
            </h2>
            <p
              className="fade-in delay-100"
              style={{ fontSize: 17, color: '#E89A90', fontWeight: 500, marginBottom: 20 }}
            >
              Преподаватель английского языка
            </p>

            <p
              className="fade-in delay-200"
              style={{ fontSize: 16, color: '#A1A1AA', lineHeight: 1.75, marginBottom: 32 }}
            >
              В свободное время я танцую танго, путешествую и занимаюсь самообразованием.
              Если вы ищете интересного собеседника на уровне C1–C2, пишите — нам будет о чём поболтать.
            </p>

            <div className="fade-in delay-300">
              <CTAButton label="Записаться на занятие" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── PRICING ─────────────────────────────────────────────── */
function Pricing() {
  return (
    <section id="pricing" className="section">
      <div className="container">
        <div
          className="fade-in"
          style={{
            maxWidth: 720,
            margin: '0 auto',
            padding: '48px 32px',
            background: 'linear-gradient(145deg, rgba(200,120,120,0.10), rgba(232,168,144,0.06))',
            border: '1px solid rgba(200,120,120,0.35)',
            borderRadius: 24,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <span className="section-label">Стоимость</span>
          <h2
            style={{
              fontSize: 'clamp(24px, 3.5vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: 4,
            }}
          >
            От{' '}
            <span className="gradient-text" style={{ fontWeight: 900 }}>
              3 500 ₽
            </span>{' '}
            за занятие
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 17, lineHeight: 1.6, maxWidth: 540 }}>
            Финальная сумма зависит от формата, длительности и плана подготовки. Сначала согласуем
            детали в Telegram, затем удобный перевод по ссылке.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              justifyContent: 'center',
              marginTop: 12,
            }}
          >
            <CTAButton size="md" label="Обсудить в Telegram" />
            <Link
              href="/pay"
              className="btn-secondary"
              onClick={() => trackEvent('pay_link_click_pricing')}
            >
              Перейти к оплате
            </Link>
          </div>
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
            Начнём прямо сейчас
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
            Начните обучение{' '}
            <span className="gradient-text">под свою цель</span>
          </h2>
          <p
            style={{
              color: '#A1A1AA',
              fontSize: 17,
              marginBottom: 36,
              maxWidth: 460,
              margin: '0 auto 36px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            Первый шаг — написать в Telegram. Обсудим вашу цель и подберём оптимальную программу.
          </p>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <CTAButton size="lg" />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── FOOTER ──────────────────────────────────────────────── */
function Footer() {
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
          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #C87878, #E8A890)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  color: '#fff',
                  fontSize: 16,
                }}
              >
                L
              </div>
              <span style={{ fontWeight: 700, fontSize: 17 }}>
                Level<span className="gradient-text">Channel</span>
              </span>
            </div>
            <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.65 }}>
              Индивидуальные онлайн-занятия по английскому языку 1:1
            </p>
          </div>

          {/* Реквизиты */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#fff' }}>Реквизиты</h3>
            <div style={{ fontSize: 13, color: '#71717A', lineHeight: 2 }}>
              <div>ИП Фирсова Анастасия Геннадьевна</div>
              <div>ИНН: 673202755730</div>
              <div>Р/С: 40802810720000971101</div>
              <div>Банк: ООО «Банк Точка»</div>
              <div>БИК: 044525104</div>
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#fff' }}>Документы</h3>
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
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 14,
                  color: '#A1A1AA',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#fff')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#A1A1AA')}
              >
                <TelegramIcon size={14} />
                Telegram
              </a>
            </div>
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
export default function HomePage() {
  useScrollAnimation()
  useScrollDepth()

  useEffect(() => {
    trackEvent('page_view')
  }, [])

  return (
    <>
      <Header />
      <main>
        <Hero />
        <TrustStats />
        <UseCases />
        <Process />
        <Results />
        <Teacher />
        <Pricing />
        <FinalCTA />
      </main>
      <Footer />
    </>
  )
}
