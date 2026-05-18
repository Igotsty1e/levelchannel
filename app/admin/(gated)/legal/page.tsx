import { listLegalVersions } from '@/lib/legal/versions'

import { LegalVersionsManager } from './versions-manager'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata = {
  title: 'Документы. Версии. Админка',
}

// Wave 19. admin Versions UI for legal documents.
//
// Tabs per kind (offer / privacy / personal_data). Each tab lists
// the existing versions newest-first and a "Создать версию v…"
// form below. Publishing a new version snapshots the body_md and
// chains previous_version_id automatically (lib/legal/versions.ts:
// createLegalVersion). The form has no rich editor; operator
// pastes the markdown body directly.
//
// Public-side history surface lives at /legal/v/[id] and renders
// the body verbatim. Linkable, citable, and what the consent FK
// chain ultimately points at.

export default async function AdminLegalPage() {
  const [offer, privacy, personalData] = await Promise.all([
    listLegalVersions('offer', 50),
    listLegalVersions('privacy', 50),
    listLegalVersions('personal_data', 50),
  ])

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Документы и соглашения
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
        Каждая версия. это снимок текста на момент его публикации.
        Согласия пользователей привязываются к конкретной версии,
        поэтому редактировать опубликованные версии нельзя. Чтобы
        обновить документ, опубликуйте следующую версию.
      </p>

      <LegalVersionsManager
        initial={{ offer, privacy, personal_data: personalData }}
      />
    </>
  )
}
