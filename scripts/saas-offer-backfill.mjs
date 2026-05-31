#!/usr/bin/env node
// SAAS-OFFER A1.1 (2026-05-31) — backfill saas_offer consent для
// существующих учителей которые зарегистрировались ДО включения гейта.
//
// Когда запускать:
//   ПОСЛЕ admin publish реальной v1 SaaS-оферты + v1 Приложения № 1
//   (не placeholder), ДО флипа SAAS_OFFER_GATE_ENABLED=1.
//
// Безопасность: idempotent. Повторный запуск пропускает уже
// backfilled учителей. dry-run по умолчанию; пишет только при --confirm.
//
// Usage:
//   node scripts/saas-offer-backfill.mjs              # dry-run
//   node scripts/saas-offer-backfill.mjs --confirm    # apply
//
// Что делает per teacher:
//   1. SELECT id FROM account_consents WHERE account_id=$1 AND
//      document_kind='saas_offer' AND revoked_at IS NULL ORDER BY
//      accepted_at DESC LIMIT 1.
//   2. Если row exists AND FK matches current live → skip.
//   3. Иначе INSERT saas_offer consent с FK = current live id и
//      documentVersion = 'saas_offer:vN+processor_terms:vM' (per
//      Приложение Q5).
//   4. INSERT audit row в auth_audit_events (event_type =
//      'auth.teacher.saas_offer_backfilled').
//
// CLI flags:
//   --confirm    apply changes (без него — dry-run)
//   --limit=N    ограничить выборку N teacher-аккаунтами (testing)
import 'dotenv/config'
import pg from 'pg'

const DRY_RUN = !process.argv.includes('--confirm')
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith('--limit='))
  return arg ? parseInt(arg.split('=')[1], 10) : null
})()

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL не задан')
    process.exit(2)
  }
  const pool = new pg.Pool({ connectionString: dbUrl })

  // 1. Получаем live saas_offer (non-placeholder).
  const offerLive = await pool.query(
    `SELECT id, version_label
       FROM legal_document_versions
      WHERE doc_kind = 'saas_offer'
        AND effective_from <= now()
        AND version_label NOT LIKE 'v0-placeholder-%'
      ORDER BY effective_from DESC
      LIMIT 1`,
  )
  if (offerLive.rows.length === 0) {
    console.error(
      'saas_offer live version не опубликована (или только placeholder). Опубликуйте через /admin/legal до backfill.',
    )
    process.exit(3)
  }
  const offer = offerLive.rows[0]

  // 2. Получаем live saas_processor_terms (если есть).
  const processorLive = await pool.query(
    `SELECT id, version_label
       FROM legal_document_versions
      WHERE doc_kind = 'saas_processor_terms'
        AND effective_from <= now()
        AND version_label NOT LIKE 'v0-placeholder-%'
      ORDER BY effective_from DESC
      LIMIT 1`,
  )
  const processor = processorLive.rows[0] ?? null

  const combinedVersion = processor
    ? `saas_offer:${offer.version_label}+processor_terms:${processor.version_label}`
    : `saas_offer:${offer.version_label}`

  console.log(`live saas_offer: ${offer.version_label} (id=${offer.id})`)
  if (processor) {
    console.log(
      `live saas_processor_terms: ${processor.version_label} (id=${processor.id})`,
    )
  } else {
    console.log(
      `live saas_processor_terms: ОТСУТСТВУЕТ — backfill пишет только saas_offer.`,
    )
  }
  console.log(`combinedVersion: ${combinedVersion}`)
  console.log(`mode: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`)
  if (LIMIT) console.log(`limit: ${LIMIT} teachers`)

  // 3. Получаем всех активных teacher-аккаунтов.
  const teachersQ = await pool.query(
    `SELECT a.id, a.email
       FROM accounts a
       JOIN account_roles r ON r.account_id = a.id AND r.role = 'teacher'
      WHERE a.email_verified_at IS NOT NULL
        AND a.disabled_at IS NULL
        AND a.scheduled_purge_at IS NULL
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
  )
  console.log(`\nfound ${teachersQ.rows.length} eligible teachers\n`)

  let skipped = 0
  let inserted = 0
  let errors = 0

  for (const t of teachersQ.rows) {
    try {
      const existing = await pool.query(
        `SELECT id, legal_document_version_id
           FROM account_consents
          WHERE account_id = $1
            AND document_kind = 'saas_offer'
            AND revoked_at IS NULL
          ORDER BY accepted_at DESC
          LIMIT 1`,
        [t.id],
      )
      if (
        existing.rows[0]
        && existing.rows[0].legal_document_version_id === offer.id
      ) {
        skipped++
        continue
      }
      if (DRY_RUN) {
        console.log(`would insert consent for ${t.email}`)
        inserted++
        continue
      }
      await pool.query('BEGIN')
      await pool.query(
        `INSERT INTO account_consents
           (id, account_id, document_kind, document_version, document_path,
            accepted_at, ip, user_agent, legal_document_version_id)
         VALUES (gen_random_uuid(), $1, 'saas_offer', $2, '/saas/offer',
                 now(), NULL, NULL, $3)`,
        [t.id, combinedVersion, offer.id],
      )
      await pool.query(
        `INSERT INTO auth_audit_events
           (event_type, account_id, email_hash, payload)
         VALUES ('auth.teacher.saas_offer_backfilled', $1, '',
                 jsonb_build_object('combinedVersion', $2::text))`,
        [t.id, combinedVersion],
      )
      await pool.query('COMMIT')
      inserted++
      console.log(`inserted consent for ${t.email}`)
    } catch (e) {
      await pool.query('ROLLBACK').catch(() => {})
      errors++
      console.error(`error for ${t.email}: ${e.message}`)
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(`skipped (already current): ${skipped}`)
  console.log(`${DRY_RUN ? 'would-insert' : 'inserted'}: ${inserted}`)
  console.log(`errors: ${errors}`)

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
