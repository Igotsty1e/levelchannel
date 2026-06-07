'use client'

import { motion } from 'framer-motion'

import { AssetOrPlaceholder } from '../_shared/placeholder'

const fadeUp = { initial: { opacity: 0, y: 40 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-100px' } }

export function ScreenPain1() {
  return (
    <section id="pains" className="landing-v3-section">
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <motion.h2
          {...fadeUp}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="landing-v3-h2 landing-v3-h2--serif"
        >
          Каждое занятие — это <em>три сервиса</em> и десяток сообщений в мессенджерах.
        </motion.h2>

        <motion.div {...fadeUp} transition={{ duration: 0.8, delay: 0.1 }} className="landing-v3-illust" style={{ marginTop: 56, marginBottom: 40 }}>
          <AssetOrPlaceholder
            src="/assets/landing-v3/illustrations/desk-chaos.png"
            alt="Хаос на столе репетитора"
            aspectRatio="3 / 2"
          />
        </motion.div>

        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.15 }} className="landing-v3-body-editorial">
          Утром приходит сообщение в Telegram «можем перенести на четверг?». Открываешь
          Excel, проверяешь четверг 18:00. Кажется, свободно. Пишешь Маше «свободно,
          подтверди?». Маша отвечает через сорок минут. Перенос готов. Это пять переписок
          и два прыжка между приложениями.
        </motion.p>

        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.2 }} className="landing-v3-body-editorial">
          Параллельно мама Пети просит реквизиты для оплаты. Копируешь номер карты из
          закреплённого сообщения, отправляешь в чат. Через час приходит скриншот перевода.
          Делаешь запись в блокноте: Петя, февраль оплачен, 4 урока. Блокнот, заметка, готово.
        </motion.p>

        <motion.p {...fadeUp} transition={{ duration: 0.7, delay: 0.25 }} className="landing-v3-body-editorial">
          Так и идёт день. Telegram, Excel, блокнот. Шесть учеников, шесть таких микро-циклов
          до обеда. И всё это до того, как ты открыл учебник и сел готовиться к первому уроку.
        </motion.p>

        <motion.blockquote
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="landing-v3-pullquote"
        >
          «Я устаю не от уроков. Я устаю от того, что между уроками.»
        </motion.blockquote>
      </div>
    </section>
  )
}
