import {
  listOperatorSettingsForAdmin,
  SETTING_SCHEMA,
  type SettingKey,
} from '@/lib/admin/operator-settings'

import { SettingEditor } from '../alerts/setting-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Гейт SaaS-оферты. Админка',
}

// SAAS-OFFER A1 (2026-05-31) — admin surface для SAAS_OFFER_GATE_ENABLED
// gate flag.
//
// Контекст:
//   - Sub-A.2 foundation добавил гейт-инфраструктуру: предикат
//     `evaluateSaasOfferGate`, 3 SSR-route (/saas/offer, /saas-offer-
//     accept, /saas-offer-awaiting), POST /api/teacher/saas-offer-accept.
//     Флаг SAAS_OFFER_GATE_ENABLED по умолчанию OFF — гейт инертен.
//   - A1 (этот PR) добавляет SSR hookup в app/teacher/layout.tsx → гейт
//     при ON редиректит non-consenting teacher на /saas-offer-accept.
//   - A1.1 (отдельный PR) добавит route swap на /api/teacher/** + register
//     flow refactor + backfill — после чего гейт станет полным perimeter.
//
// Эта страница — единственная UI-точка где оператор может флипнуть
// SAAS_OFFER_GATE_ENABLED с 0 → 1. Не флипай, пока:
//   1. Опубликована реальная v1 SaaS-оферты через `/admin/legal` (не
//      placeholder `v0-placeholder-*`).
//   2. Опубликована реальная v1 Приложения № 1 (то же).
//   3. Запущен A1.1 (route swap) — иначе остаются API-ручки, которые
//      позволяют не-consenting teacher мутировать состояние.

const GATE_KEYS: ReadonlyArray<SettingKey> = ['SAAS_OFFER_GATE_ENABLED']

export default async function AdminSaasOfferGatePage() {
  const settings = await listOperatorSettingsForAdmin()
  const migrationPending =
    'migrationPending' in settings && settings.migrationPending === true

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Гейт SaaS-оферты
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 24,
          maxWidth: 720,
        }}
      >
        Один рубильник:{' '}
        <code style={{ fontFamily: 'ui-monospace, monospace' }}>
          SAAS_OFFER_GATE_ENABLED
        </code>
        . По умолчанию ВЫКЛЮЧЕН (значение 0). Не включайте, пока не
        опубликована реальная редакция SaaS-оферты и Приложения № 1
        через раздел «Документы и соглашения», и пока не сделан route-
        swap на /api/teacher/** (PR A1.1).
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>
          Рубильник
        </h2>
        {migrationPending ? (
          <p
            style={{
              color: 'var(--danger, #e07676)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            Таблица operator_settings не создана. Запустите миграции до
            использования рубильника.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {GATE_KEYS.map((key) => {
              const schema = SETTING_SCHEMA[key]
              const view = settings.keys[key]
              if (!view) return null
              return (
                <SettingEditor
                  key={key}
                  settingKey={key}
                  meta={schema}
                  value={view.value}
                  source={view.source}
                  rawDb={view.rawDb}
                  rawEnv={view.rawEnv}
                  updatedAt={view.updatedAt}
                />
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>
          Чек-лист перед включением
        </h2>
        <ol
          style={{
            color: 'var(--secondary)',
            fontSize: 13,
            lineHeight: 1.8,
            paddingLeft: 20,
          }}
        >
          <li>
            Опубликована v1 SaaS-оферты через раздел{' '}
            <a href="/admin/legal" style={{ color: 'inherit' }}>
              «Документы и соглашения»
            </a>
            . Метка версии — НЕ префиксом{' '}
            <code style={{ fontFamily: 'ui-monospace, monospace' }}>
              v0-placeholder-
            </code>
            .
          </li>
          <li>
            Опубликована v1 Приложения № 1 «Условия поручения оператора
            учителю» в том же разделе. Раздельная публикация недопустима —
            иначе ссылка из v2 §6.3.2 на /saas/processor-terms возвращает
            404.
          </li>
          <li>
            Замержен PR A1.1 (route swap на /api/teacher/** + register
            flow refactor). Без него API-ручки остаются открытыми для
            non-consenting teacher.
          </li>
          <li>
            Запущен скрипт{' '}
            <code style={{ fontFamily: 'ui-monospace, monospace' }}>
              scripts/saas-offer-backfill.mjs
            </code>{' '}
            для существующих учителей (если выбран backfill-путь Q-A.6) —
            или решено пустить всех через interstitial /saas-offer-accept.
          </li>
          <li>
            Платформа внесена в реестр операторов ПД Роскомнадзора по
            ст. 22 № 152-ФЗ.
          </li>
        </ol>
      </section>
    </>
  )
}
