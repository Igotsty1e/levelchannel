#!/usr/bin/env node
// One-shot: publish v1 SaaS-оферту + v1 Приложение №1 + backfill + flip gate.
//
// Plan: docs/plans/2026-05-31-cleanup-and-bugs.md «SaaS go-live».
//
// Идемпотентен на каждой стадии. Безопасен к повторному запуску.
//
// Usage (run on prod after autodeploy):
//   node scripts/saas-go-live.mjs              # dry-run, печатает что бы сделалось
//   node scripts/saas-go-live.mjs --apply      # commit changes + run backfill + flip gate
//
// Order of operations (per scripts/saas-offer-backfill.mjs invariants):
//   1. Verify admin account.
//   2. Publish saas_offer v1 (skip if same version_label exists).
//   3. Publish saas_processor_terms v1 (same).
//   4. Backfill consent rows для existing teachers → они НЕ видят /saas-offer-accept.
//   5. Flip SAAS_OFFER_GATE_ENABLED → 1.
//   6. Print summary.
//
// What flipping does for end-users:
//   - Self-registered teachers ALREADY consented at registration (`saas_offer`).
//     Backfill в (4) добавляет consent тем кто регался ДО Sub-A.2/3 wave shipped
//     (т.е. до 2026-05-30). После backfill ВСЕ существующие учителя
//     прозрачно «consented to v1».
//   - НОВЫЕ teacher registrations (после флипа) уже идут через
//     `/saas-offer-accept` gate в layout, т.к. SSR hookup был shipped в PR #453.
//   - НЕ-consenting hybrid (admin+teacher) при flip получит redirect на
//     /saas-offer-accept — а если backfill отработал на admin'е тоже, его
//     redirect'нёт хотя он admin. Защита: backfill пропускает админов?
//     ПРОВЕРИТЬ: scripts/saas-offer-backfill.mjs SELECT account_roles =
//     'teacher' — да, только teacher. Admin'а не трогает. OK.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import 'dotenv/config'
import pg from 'pg'

const APPLY = process.argv.includes('--apply')

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const OFFER_DRAFT_PATH = path.join(
  REPO_ROOT,
  'docs/legal/saas-drafts/saas-offer-draft-v2-operator-deferred.md',
)
const PROCESSOR_DRAFT_PATH = path.join(
  REPO_ROOT,
  'docs/legal/saas-drafts/saas-processor-terms-draft-v1.md',
)

// Versions включают дату из репозитория-фиксации, чтобы ON CONFLICT по
// (doc_kind, version_label) был детерминирован, но позволял v1.1 в следующий раз.
const OFFER_VERSION_LABEL = 'v1-2026-06-01'
const PROCESSOR_VERSION_LABEL = 'v1-2026-06-01'

// «Дата редакции: __ ____ 2026 г.» → реальная дата
const HUMAN_DATE_RU = '1 июня 2026 г.'

function fillDate(bodyMd) {
  return bodyMd.replace(/Дата редакции:\s*__\s*____\s*2026\s*г\./g, `Дата редакции: ${HUMAN_DATE_RU}`)
}

async function findAdminAccountId(pool) {
  const r = await pool.query(`
    SELECT a.id, a.email
      FROM accounts a
      JOIN account_roles ar ON ar.account_id = a.id AND ar.role = 'admin'
     WHERE a.disabled_at IS NULL
       AND a.scheduled_purge_at IS NULL
     ORDER BY a.created_at ASC
     LIMIT 1
  `)
  if (r.rows.length === 0) {
    throw new Error('No admin account found in DB')
  }
  return { id: r.rows[0].id, email: r.rows[0].email }
}

async function publishLegalVersion(pool, { docKind, versionLabel, bodyMd, createdByAccountId }) {
  const exists = await pool.query(
    `SELECT id FROM legal_document_versions WHERE doc_kind = $1 AND version_label = $2 LIMIT 1`,
    [docKind, versionLabel],
  )
  if (exists.rows.length > 0) {
    return { action: 'skip', id: exists.rows[0].id, reason: 'version_label_already_published' }
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`legal:${docKind}`])
    const prev = await client.query(
      `SELECT id FROM legal_document_versions
         WHERE doc_kind = $1
         ORDER BY effective_from DESC, created_at DESC
         LIMIT 1`,
      [docKind],
    )
    const previousVersionId = prev.rows[0] ? String(prev.rows[0].id) : null
    const inserted = await client.query(
      `INSERT INTO legal_document_versions
         (doc_kind, version_label, effective_from, body_md,
          previous_version_id, created_by_account_id)
       VALUES ($1, $2, now(), $3, $4, $5)
       RETURNING id`,
      [docKind, versionLabel, bodyMd, previousVersionId, createdByAccountId],
    )
    await client.query('COMMIT')
    return { action: 'insert', id: inserted.rows[0].id, previousVersionId }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function runBackfill() {
  return new Promise((resolve, reject) => {
    const script = path.join(REPO_ROOT, 'scripts/saas-offer-backfill.mjs')
    const proc = spawn('node', [script, '--confirm'], {
      stdio: 'inherit',
      env: process.env,
    })
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`backfill exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

async function flipGate(pool, adminId) {
  const SETTING_KEY = 'SAAS_OFFER_GATE_ENABLED'
  const SETTING_DESC = 'master switch (1=on/0=off) for the SaaS-оферта consent gate. Flipped via scripts/saas-go-live.mjs.'

  const prior = await pool.query(
    `SELECT value FROM operator_settings WHERE key = $1`,
    [SETTING_KEY],
  )
  if (prior.rows[0]?.value === '1') {
    return { action: 'skip', reason: 'already_enabled' }
  }
  if (prior.rows.length === 0) {
    const r = await pool.query(
      `INSERT INTO operator_settings (key, value, description, updated_by_account_id)
       VALUES ($1, '1', $2, $3)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [SETTING_KEY, SETTING_DESC, adminId],
    )
    if (r.rows.length === 0) {
      // raced with concurrent insert; treat as update path
      await pool.query(
        `UPDATE operator_settings SET value='1', updated_at=now(),
           description = $2, updated_by_account_id = $3
         WHERE key = $1`,
        [SETTING_KEY, SETTING_DESC, adminId],
      )
      return { action: 'update_after_race' }
    }
    return { action: 'insert' }
  }
  await pool.query(
    `UPDATE operator_settings SET value='1', updated_at=now(),
       description = $2, updated_by_account_id = $3
     WHERE key = $1`,
    [SETTING_KEY, SETTING_DESC, adminId],
  )
  return { action: 'update', prior_value: prior.rows[0].value }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL не задан')
    process.exit(2)
  }

  const pool = new pg.Pool({ connectionString: dbUrl })

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`offer label: ${OFFER_VERSION_LABEL}`)
  console.log(`processor label: ${PROCESSOR_VERSION_LABEL}`)
  console.log()

  const offerBodyRaw = readFileSync(OFFER_DRAFT_PATH, 'utf-8')
  const processorBodyRaw = readFileSync(PROCESSOR_DRAFT_PATH, 'utf-8')
  const offerBody = fillDate(offerBodyRaw)
  const processorBody = fillDate(processorBodyRaw)
  console.log(`offer draft: ${offerBody.length} chars (raw ${offerBodyRaw.length}, date filled: ${offerBody !== offerBodyRaw})`)
  console.log(`processor draft: ${processorBody.length} chars (raw ${processorBodyRaw.length}, date filled: ${processorBody !== processorBodyRaw})`)

  const admin = await findAdminAccountId(pool)
  console.log(`admin actor: ${admin.email} (${admin.id})`)
  console.log()

  // Stage 1+2: publish texts
  if (APPLY) {
    const r1 = await publishLegalVersion(pool, {
      docKind: 'saas_offer',
      versionLabel: OFFER_VERSION_LABEL,
      bodyMd: offerBody,
      createdByAccountId: admin.id,
    })
    console.log(`saas_offer ${OFFER_VERSION_LABEL}: ${r1.action} (id=${r1.id}, prev=${r1.previousVersionId ?? '-'})`)
    const r2 = await publishLegalVersion(pool, {
      docKind: 'saas_processor_terms',
      versionLabel: PROCESSOR_VERSION_LABEL,
      bodyMd: processorBody,
      createdByAccountId: admin.id,
    })
    console.log(`saas_processor_terms ${PROCESSOR_VERSION_LABEL}: ${r2.action} (id=${r2.id}, prev=${r2.previousVersionId ?? '-'})`)
  } else {
    const offerCur = await pool.query(
      `SELECT version_label FROM legal_document_versions WHERE doc_kind='saas_offer' ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
    )
    const processorCur = await pool.query(
      `SELECT version_label FROM legal_document_versions WHERE doc_kind='saas_processor_terms' ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
    )
    console.log(`saas_offer current: ${offerCur.rows[0]?.version_label ?? 'none'} → would publish: ${OFFER_VERSION_LABEL}`)
    console.log(`saas_processor_terms current: ${processorCur.rows[0]?.version_label ?? 'none'} → would publish: ${PROCESSOR_VERSION_LABEL}`)
  }
  console.log()

  // Stage 3: backfill consent rows
  if (APPLY) {
    console.log('=== BACKFILL ===')
    await runBackfill()
    console.log()
  } else {
    console.log('backfill skipped (dry-run). Would run: node scripts/saas-offer-backfill.mjs --confirm')
    console.log()
  }

  // Stage 4: flip gate
  if (APPLY) {
    const flip = await flipGate(pool, admin.id)
    console.log(`gate flip: ${flip.action} (reason: ${flip.reason ?? '-'}${flip.prior_value !== undefined ? `, prior=${flip.prior_value}` : ''})`)
  } else {
    const cur = await pool.query(
      `SELECT value FROM operator_settings WHERE key = 'SAAS_OFFER_GATE_ENABLED'`,
    )
    console.log(`gate current: ${cur.rows[0]?.value ?? '(unset, default 0)'} → would flip to: 1`)
  }

  await pool.end()
  console.log()
  console.log('done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
