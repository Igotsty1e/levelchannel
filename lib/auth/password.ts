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
