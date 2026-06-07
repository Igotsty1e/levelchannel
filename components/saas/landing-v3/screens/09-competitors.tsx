'use client'

import { motion } from 'framer-motion'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

type Value = {
  title: string
  body: string
}

const VALUES: Value[] = [
  {
    title: 'Сэкономит время',
    body: 'То, что раньше занимало два часа в день — переписки, счета, переносы — теперь занимает ноль. Это и есть наш единственный продукт.',
  },
  {
    title: 'Поможет создать систему',
    body: 'Пакеты, тарифы, баланс, история — это твоя система учёта. Один раз настроил — дальше она ведёт сама. Можно показать налоговой, можно передать новому помощнику.',
  },
  {
    title: 'Упростит жизнь',
    body: 'Без CRM-комбайнов и LMS-настроек. Шесть полей, четыре экрана, всё на «ты». Минимум, который реально работает на репетитора-частника.',
  },
]

export function ScreenCompetitors() {
  return (
    <section className="landing-v3-section">
      <div style={{ textAlign: 'center', marginBottom: 64 }}>
        <motion.h2 {...fadeUp} transition={{ duration: 0.7 }} className="landing-v3-h2 landing-v3-h2--serif">
          Сделан <em>специально для тебя.</em> Без лишнего.
        </motion.h2>
        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.1 }} className="landing-v3-lede" style={{ margin: '20px auto 0' }}>
          Не для школ. Не для крупных онлайн-курсов. Не для агентств. Для одного репетитора,
          который ведёт от одного до тридцати учеников и сам решает, как ему удобно работать.
        </motion.p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 1100, margin: '0 auto' }}>
        {VALUES.map((v, idx) => (
          <motion.div
            key={v.title}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: idx * 0.1 }}
            className="landing-v3-card"
            style={{ padding: 32 }}
          >
            <h3 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 14px', color: 'var(--v3-accent-end)' }}>{v.title}</h3>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--v3-text-secondary)', margin: 0 }}>{v.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
