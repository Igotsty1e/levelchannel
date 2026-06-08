'use client'

import { motion } from 'framer-motion'

import { NumberTicker } from '@/components/ui/aceternity'

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
}

// Записи в реальном блокноте — как пишет уставший репетитор поздно вечером
const NOTES = [
  { text: 'Петя — февраль, 4 урока — оплачено', mood: 'paid' as const },
  { text: 'Аня — январь, 8 уроков — ?', mood: 'doubt' as const },
  { text: 'Маша — январь — должна за два', mood: 'debt' as const },
  { text: 'Кирилл — пакет с декабря — неясно остался или нет', mood: 'doubt' as const },
  { text: 'Лена — февраль, 1 урок — оплачено', mood: 'paid' as const },
  { text: 'Олег — забыл записать когда платил', mood: 'doubt' as const },
  { text: 'Маша — наличкой 1500 за прошлый понедельник?', mood: 'doubt' as const },
  { text: 'Сама не помню за январь', mood: 'doubt' as const, strikethrough: true },
]

const MOOD_COLOR = {
  paid: 'rgba(155, 215, 178, 0.9)', // тёплый зелёный
  debt: 'rgba(232, 168, 144, 0.95)', // brand accent
  doubt: 'rgba(232, 168, 144, 0.75)',
}

export function ScreenPain2() {
  return (
    <section className="landing-v3-section" style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 56 }}>
        <div style={{ maxWidth: 880, marginInline: 'auto', textAlign: 'center' }}>
          <motion.h2
            {...fadeUp}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="landing-v3-h2 landing-v3-h2--serif"
          >
            А в конце месяца ты не помнишь, <em>кто за что заплатил.</em>
          </motion.h2>
          <motion.p
            {...fadeUp}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="landing-v3-lede"
            style={{ marginTop: 24, marginInline: 'auto' }}
          >
            Часть на карту. Часть наличкой. Часть пакетом за месяц вперёд. И всё это разбросано — по переписке, по чекам перевода, по блокноту, по голове.
          </motion.p>
        </div>

        {/* ── Один лист блокнота ──────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'relative',
            maxWidth: 720,
            marginInline: 'auto',
            background: '#1A1714',
            border: '1px solid rgba(255, 220, 180, 0.06)',
            borderRadius: 8,
            // деревянная тень + бумажный warm glow
            boxShadow: [
              '0 30px 80px -30px rgba(0,0,0,0.65)',
              '0 60px 120px -40px rgba(0,0,0,0.45)',
              'inset 0 0 0 1px rgba(255,255,255,0.02)',
            ].join(', '),
            // тонкая линовка через repeating gradient
            backgroundImage:
              'repeating-linear-gradient(180deg, transparent 0, transparent 35px, rgba(255, 220, 180, 0.05) 35px, rgba(255, 220, 180, 0.05) 36px)',
            padding: 'clamp(36px, 5vw, 64px) clamp(40px, 6vw, 80px) clamp(40px, 5vw, 60px)',
            transform: 'rotate(-0.4deg)',
          }}
        >
          {/* красная margin-линия */}
          <div
            style={{
              position: 'absolute',
              left: 'clamp(28px, 4vw, 56px)',
              top: 0,
              bottom: 0,
              width: 1,
              background: 'rgba(232, 168, 144, 0.18)',
            }}
          />
          {/* перфорация листа сверху */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 18,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: 60,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(0,0,0,0.4)' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(0,0,0,0.4)' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(0,0,0,0.4)' }} />
          </div>

          {/* шапка листа */}
          <div
            style={{
              fontFamily: 'Caveat, "Bradley Hand", cursive',
              fontSize: 28,
              color: 'rgba(245, 245, 247, 0.92)',
              marginBottom: 18,
              transform: 'rotate(0.6deg)',
            }}
          >
            Кто за что платил?
          </div>
          <div
            style={{
              fontFamily: 'Caveat, "Bradley Hand", cursive',
              fontSize: 18,
              color: 'rgba(232, 168, 144, 0.85)',
              marginBottom: 24,
            }}
          >
            (восстанавливаю по чатам и переводам)
          </div>

          {/* строки записей */}
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 8,
              fontFamily: 'Caveat, "Bradley Hand", cursive',
              fontSize: 22,
              lineHeight: 1.6,
              color: 'rgba(245, 245, 247, 0.85)',
            }}
          >
            {NOTES.map((n, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: 0.15 + i * 0.12 }}
                style={{
                  position: 'relative',
                  paddingLeft: 24,
                  textDecoration: n.strikethrough ? 'line-through' : 'none',
                  textDecorationColor: 'rgba(232, 168, 144, 0.6)',
                  textDecorationThickness: '2px',
                  transform: `rotate(${(i % 2 === 0 ? -0.3 : 0.2)}deg)`,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 6,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: MOOD_COLOR[n.mood],
                    opacity: 0.65,
                  }}
                />
                {n.text}
              </motion.li>
            ))}
          </ul>

          {/* нижняя помарка — авторская приписка */}
          <div
            style={{
              marginTop: 36,
              fontFamily: 'Caveat, "Bradley Hand", cursive',
              fontSize: 20,
              color: 'rgba(232, 168, 144, 0.85)',
              transform: 'rotate(-1.2deg)',
              textAlign: 'right',
            }}
          >
            …и так каждый декабрь. ¯\_(ツ)_/¯
          </div>
        </motion.div>

        {/* Цифра потери — компактнее, без рамки-карточки */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.8, delay: 0.4 }}
          style={{
            maxWidth: 720,
            marginInline: 'auto',
            textAlign: 'center',
            display: 'grid',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: 'var(--v3-text-muted)' }}>в среднем</span>
            <span
              style={{
                fontSize: 'clamp(40px, 6vw, 72px)',
                fontWeight: 700,
                color: 'var(--v3-accent-end)',
                letterSpacing: '-0.03em',
                fontVariantNumeric: 'tabular-nums',
                fontFamily: 'var(--v3-font-serif, Charter, Georgia, serif)',
              }}
            >
              <NumberTicker value={14700} />
            </span>
            <span style={{ fontSize: 24, color: 'var(--v3-text-secondary)' }}>₽</span>
            <span style={{ fontSize: 14, color: 'var(--v3-text-muted)' }}>в квартал</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--v3-text-muted)', lineHeight: 1.55 }}>
            теряет репетитор, который не ведёт балансы — по нашим разговорам с владельцами кабинетов.
          </p>
        </motion.div>
      </div>
    </section>
  )
}
