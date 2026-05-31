// SAAS-OFFER bundle A1 follow-up (2026-05-31) — публичная surface для
// Приложения № 1 «Условия поручения оператора учителю» к v2 SaaS-оферты.
//
// Файл — обязательный спутник /saas/offer. Без рабочего route ссылка
// из v2 §6.3.2 (https://levelchannel.ru/saas/processor-terms) ведёт в
// 404, и конструкция «учитель действует по поручению Платформы» по
// ч. 3 ст. 6 № 152-ФЗ теряет правовое основание.
//
// Тот же паттерн что у /saas/offer: рендерит body_md текущей живой
// версии doc_kind `saas_processor_terms` через LegalBodyRenderer.
// Mig 0097 садит `v0-placeholder-do-not-accept`; реальная v1
// публикуется admin'ом через `/admin/legal` одновременно с v1 SaaS-
// оферты (раздельная публикация недопустима — иначе ссылка из v2 §6.3.2
// возвращает 404).
//
// Метаданные: `noindex` пока не запущен публичный self-serve recurrent
// (соответствует Epic 4-DEFERRED посадке /saas /saas/offer).
import Link from 'next/link'

import { LegalBodyRenderer } from '@/lib/legal/render-body'
import { getCurrentLegalVersion } from '@/lib/legal/versions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title:
    'Приложение № 1 — Условия поручения оператора учителю | LevelChannel',
  robots: { index: false, follow: false },
}

export default async function SaasProcessorTermsPage() {
  const live = await getCurrentLegalVersion('saas_processor_terms')

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '40px 20px',
        color: 'var(--text)',
      }}
    >
      <p style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/saas/offer" style={{ color: 'var(--secondary)' }}>
          ← К SaaS-оферте
        </Link>
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        Приложение № 1 — Условия поручения оператора учителю
      </h1>
      <p
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          marginBottom: 24,
          lineHeight: 1.6,
        }}
      >
        Является неотъемлемой частью SaaS-оферты LevelChannel. Акцепт
        SaaS-оферты Учителем одновременно означает акцепт настоящего
        Приложения.
      </p>
      {live ? (
        <>
          <p
            style={{
              color: 'var(--secondary)',
              fontSize: 13,
              marginBottom: 24,
              lineHeight: 1.6,
            }}
          >
            Версия <strong>{live.versionLabel}</strong>, действует с{' '}
            {new Date(live.effectiveFrom).toLocaleString('ru-RU')}.
          </p>
          <LegalBodyRenderer markdown={live.bodyMd} />
        </>
      ) : (
        <p
          style={{
            color: 'var(--secondary)',
            fontSize: 14,
            marginTop: 24,
            lineHeight: 1.6,
          }}
        >
          Документ не опубликован. Возвращайтесь чуть позже.
        </p>
      )}
    </main>
  )
}
