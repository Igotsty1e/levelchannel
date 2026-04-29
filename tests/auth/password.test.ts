import { describe, expect, it } from 'vitest'

import { hashPassword, verifyPassword } from '@/lib/auth/password'

describe('lib/auth/password', () => {
  it('hashes a password to a non-trivial bcrypt string', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^\$2[aby]\$/)
    expect(hash.length).toBeGreaterThan(50)
  })

  it('verifies the original password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false)
  })

  it('rejects when hash is empty (defensive guard)', async () => {
    await expect(verifyPassword('whatever', '')).resolves.toBe(false)
  })
})
