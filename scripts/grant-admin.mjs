#!/usr/bin/env node
//
// Phase 3 admin bootstrap. The cabinet has no UI to grant the very
// first `admin` role — every subsequent grant flows through
// /admin/accounts/[id], but the first one needs an operator-side
// path. This script is that path.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/grant-admin.mjs <email>
//
// Behavior:
//   - normalizes the e-mail (trim + lower) the same way the auth
//     code does
//   - if no account with that e-mail exists → exit 1, "Account not found"
//   - if the account already has `admin` → exit 0, "Already admin"
//   - otherwise inserts into account_roles with `granted_by_account_id`
//     null (this is a CLI bootstrap, not a UI grant)
//   - prints a single-line summary to stdout: account_id + e-mail
//
// Deliberately NOT supported: bulk grant, role lookup. This is the
// minimal bootstrap; everything else is /admin.

import pg from 'pg'

import { resolveSslConfig } from './_pg-ssl.mjs'

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: node scripts/grant-admin.mjs <email>')
    process.exit(2)
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.')
    process.exit(2)
  }

  const email = normalizeEmail(arg)
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: resolveSslConfig(process.env.DATABASE_URL),
  })

  try {
    const acct = await pool.query(
      `select id, email from accounts where email = $1 limit 1`,
      [email],
    )
    const row = acct.rows[0]
    if (!row) {
      console.error(`Account not found: ${email}`)
      process.exit(1)
    }
    const accountId = String(row.id)

    const existing = await pool.query(
      `select 1 from account_roles where account_id = $1 and role = 'admin' limit 1`,
      [accountId],
    )
    if (existing.rows.length > 0) {
      console.log(`Already admin: ${accountId} (${email})`)
      process.exit(0)
    }

    // Admin is mutually exclusive with teacher / student. Strip
    // consumer roles before inserting admin so the constraint enforced
    // at the application layer (lib/auth/accounts.ts:grantAccountRole)
    // isn't bypassed by the CLI bootstrap path.
    const stripped = await pool.query(
      `delete from account_roles
        where account_id = $1
          and role in ('teacher', 'student')`,
      [accountId],
    )
    if ((stripped.rowCount ?? 0) > 0) {
      console.log(
        `Stripped ${stripped.rowCount} consumer role(s) from ${email} before granting admin.`,
      )
    }

    await pool.query(
      `insert into account_roles (account_id, role, granted_by_account_id)
       values ($1, 'admin', null)`,
      [accountId],
    )
    console.log(`Granted admin: ${accountId} (${email})`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
