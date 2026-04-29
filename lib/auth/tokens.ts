import { createHash, randomBytes } from 'node:crypto'

// 32 bytes = 256 bits of entropy. base64url so the token can ride in a
// URL (verify links) and an HTTP cookie without escaping.
const TOKEN_BYTES = 32

export function mintToken(): { plain: string; hash: string } {
  const plain = randomBytes(TOKEN_BYTES).toString('base64url')
  return { plain, hash: hashToken(plain) }
}

export function hashToken(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex')
}

export function isExpired(expiresAt: string | Date): boolean {
  const ts = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  return Number.isNaN(ts.getTime()) || ts.getTime() <= Date.now()
}
