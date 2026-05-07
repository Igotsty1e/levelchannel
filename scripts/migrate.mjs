#!/usr/bin/env node
// Minimal Postgres migration runner. Zero deps beyond `pg`.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/migrate.mjs up
//   DATABASE_URL=postgres://... node scripts/migrate.mjs status
//
// Convention:
//   - Each migration is a file in migrations/ named NNNN_short_name.sql
//     where NNNN is a zero-padded sequential integer.
//   - Files are applied in lexicographic order (which equals numeric order
//     because of zero padding).
//   - Each migration runs inside its own transaction. If a migration fails,
//     the transaction is rolled back and the runner exits with code 1.
//   - Successful migrations are recorded in the `_migrations` table by
//     filename. Already-applied migrations are skipped.
//   - Migrations should be idempotent where reasonable (CREATE TABLE IF NOT
//     EXISTS, etc.) so that legacy databases that already have the schema
//     can be brought under the runner with no schema change.
//
// What this runner intentionally does NOT do:
//   - down/rollback migrations (additive-only policy until proven otherwise).
//   - run code (only .sql files).
//   - schema diff / drift detection (out of scope; tests + manual review).

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

import { resolveSslConfig } from './_pg-ssl.mjs'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const migrationsDir = path.join(repoRoot, 'migrations')

const command = process.argv[2] || 'up'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSslConfig(process.env.DATABASE_URL),
})

async function ensureMetaTable() {
  await pool.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)
}

async function listMigrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort()
}

async function listAppliedNames() {
  const result = await pool.query(`select name from _migrations order by name asc`)
  return new Set(result.rows.map((r) => String(r.name)))
}

async function applyMigration(name) {
  const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8')
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query(`insert into _migrations (name) values ($1)`, [name])
    await client.query('commit')
    console.log(`applied ${name}`)
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    console.error(`failed ${name}: ${error instanceof Error ? error.message : error}`)
    throw error
  } finally {
    client.release()
  }
}

async function up() {
  await ensureMetaTable()
  const files = await listMigrationFiles()
  const applied = await listAppliedNames()
  const pending = files.filter((f) => !applied.has(f))

  if (pending.length === 0) {
    console.log('no pending migrations')
    return
  }

  console.log(`applying ${pending.length} migration(s)`)
  for (const name of pending) {
    await applyMigration(name)
  }
  console.log('done')
}

async function status() {
  await ensureMetaTable()
  const files = await listMigrationFiles()
  const applied = await listAppliedNames()

  for (const name of files) {
    const tag = applied.has(name) ? 'applied ' : 'pending '
    console.log(`${tag} ${name}`)
  }
  const orphans = [...applied].filter((name) => !files.includes(name))
  for (const name of orphans) {
    console.log(`orphan  ${name}  (recorded but file missing)`)
  }
}

async function main() {
  if (command === 'up') {
    await up()
  } else if (command === 'status') {
    await status()
  } else {
    console.error(`unknown command: ${command}`)
    console.error('usage: node scripts/migrate.mjs [up|status]')
    process.exit(1)
  }
}

main()
  .finally(async () => {
    await pool.end()
  })
  .catch(() => {
    process.exitCode = 1
  })
