import {
  consumeSingleUseToken,
  createSingleUseToken,
} from '@/lib/auth/single-use-tokens'

export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000

export async function createEmailVerification(accountId: string) {
  return createSingleUseToken('email_verifications', accountId, EMAIL_VERIFY_TTL_MS)
}

export async function consumeEmailVerification(token: string) {
  return consumeSingleUseToken('email_verifications', token)
}
