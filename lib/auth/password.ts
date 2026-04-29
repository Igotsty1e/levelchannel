import bcrypt from 'bcryptjs'

// OWASP minimum for bcrypt is cost=10. We pick 12 — about 250 ms on
// commodity server CPU, intentionally slow so an offline attacker
// cannot mount a fast dictionary attack against a leaked hash.
const BCRYPT_COST = 12

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false
  return bcrypt.compare(plain, hash)
}

// True when the stored hash was produced under weaker parameters than
// the current policy (e.g. older accounts at cost=10 after we bumped
// to 12, or non-bcrypt prefixes after a future migration to argon2id).
//
// Login route reads this AFTER a successful verifyPassword(): if true,
// re-hash with hashPassword() and persist. Silent — the user must not
// see anything. This is how a project upgrades its password storage
// without forcing a global reset on everyone.
//
// We parse the bcrypt cost out of the hash prefix ourselves rather
// than depending on bcryptjs internals: a bcrypt hash starts with
// `$2a$NN$` / `$2b$NN$` / `$2y$NN$` where NN is the cost. Anything
// that doesn't match — including a future argon2id `$argon2id$...`
// hash if we migrate — is treated as needs-rehash so the upgrade is
// automatic on next login.
export function passwordNeedsRehash(hash: string): boolean {
  if (!hash) return false
  const m = /^\$2[aby]\$(\d{2})\$/.exec(hash)
  if (!m) {
    // Not a bcrypt hash we recognize. If the project later moves to
    // argon2id, the new hash format won't match this regex, so we'd
    // erroneously trigger a rehash on every login. The rule is:
    // update this regex AT THE SAME TIME you introduce a new hasher,
    // so the "current" format is recognized as up-to-date.
    return true
  }
  const storedCost = Number(m[1])
  return storedCost < BCRYPT_COST
}
