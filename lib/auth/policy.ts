// Conservative password policy. Long enough to outrun shoulder-surfing,
// not so onerous that users pick "Password1" to satisfy a complexity
// rule. Length is the lever; we enforce a minimum and a soft maximum.
//
// We deliberately do not enforce mixed-case / digit / symbol rules — NIST
// SP 800-63B walked away from those after empirical evidence that they
// pushed users toward predictable patterns. Instead we reject the
// well-known leaked passwords at the top of every credential-stuffing
// dictionary (lib/auth/common-passwords.ts) — the highest-value 1%
// of the policy work.

import { isCommonPassword } from '@/lib/auth/common-passwords'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export type PasswordPolicyResult =
  | { ok: true }
  | {
      ok: false
      reason: 'too_short' | 'too_long' | 'all_digits' | 'too_common'
      message: string
    }

export function validatePasswordPolicy(password: unknown): PasswordPolicyResult {
  if (typeof password !== 'string') {
    return {
      ok: false,
      reason: 'too_short',
      message: `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`,
    }
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: 'too_short',
      message: `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`,
    }
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      reason: 'too_long',
      message: `Пароль не должен превышать ${PASSWORD_MAX_LENGTH} символов.`,
    }
  }

  if (/^\d+$/.test(password)) {
    return {
      ok: false,
      reason: 'all_digits',
      message: 'Пароль не должен состоять только из цифр.',
    }
  }

  if (isCommonPassword(password)) {
    return {
      ok: false,
      reason: 'too_common',
      message:
        'Этот пароль слишком распространён и встречается в утечках. Выберите другой.',
    }
  }

  return { ok: true }
}
