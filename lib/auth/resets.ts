import {
  consumeSingleUseToken,
  createSingleUseToken,
} from '@/lib/auth/single-use-tokens'

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

export async function createPasswordReset(accountId: string) {
  return createSingleUseToken('password_resets', accountId, PASSWORD_RESET_TTL_MS)
}

export async function consumePasswordReset(token: string) {
  return consumeSingleUseToken('password_resets', token)
}
