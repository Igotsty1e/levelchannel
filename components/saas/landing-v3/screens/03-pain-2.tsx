'use client'

import { motion } from 'framer-motion'

import { NumberTicker } from '@/components/ui/aceternity'
import { AssetOrPlaceholder } from '../_shared/placeholder'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

export function ScreenPain2() {
  return (
    <section className="landing-v3-section">
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="landing-v3-h2 landing-v3-h2--serif"
        >
          В конце месяца ты не можешь точно ответить, <em>сколько заработал.</em>
        </motion.h2>

        <motion.div {...fadeUp} transition={{ duration: 0.8, delay: 0.1 }} className="landing-v3-illust" style={{ marginTop: 56, marginBottom: 40 }}>
          <AssetOrPlaceholder
            src="/assets/landing-v3/illustrations/messy-balance-book.png"
            alt="Самописный учёт балансов"
            aspectRatio="3 / 2"
          />
        </motion.div>

        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.15 }} className="landing-v3-body-editorial">
          Часть переводов приходит на карту. Часть наличкой после занятия. Часть оплатили
          родители сразу пакетом за четыре занятия вперёд. Ты теперь должен ученику эти четыре
          урока, а денег уже нет, они ушли на квартплату.
        </motion.p>

        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.2 }} className="landing-v3-body-editorial">
          Через три месяца ты не помнишь, кто оплатил февраль, а кто только январь. Не помнишь,
          у кого ещё остались уроки из пакета, а кто давно ушёл в минус. Помнишь смутно. Кажется,
          Маша должна, а Аня нет. Или наоборот.
        </motion.p>

        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.25 }} className="landing-v3-body-editorial">
          Тогда садишься на две недели и восстанавливаешь по чатам и переводам, кто кому что
          должен. Делаешь это в декабре, чтобы хотя бы налоговую не подвести. И понимаешь, что
          половину январских доходов потерял. Просто забыл записать.
        </motion.p>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.35 }}
          style={{
            marginTop: 40,
            padding: 24,
            borderRadius: 12,
            background: 'var(--v3-surface)',
            border: '1px solid var(--v3-rule)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: 'var(--v3-text-muted)' }}>~</span>
            <span style={{ fontSize: 56, fontWeight: 700, color: 'var(--v3-accent-end)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              <NumberTicker value={14700} />
            </span>
            <span style={{ fontSize: 24, color: 'var(--v3-text-secondary)' }}>₽</span>
            <span style={{ fontSize: 14, color: 'var(--v3-text-secondary)', marginLeft: 8 }}>
              столько в среднем теряет за квартал репетитор, который не ведёт балансы.*
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--v3-text-muted)', marginTop: 12, marginBottom: 0 }}>
            * Наша оценка по разговорам с владельцами кабинетов. Знаешь свою цифру? Расскажи, нам интересно.
          </p>
        </motion.div>
      </div>
    </section>
  )
}
