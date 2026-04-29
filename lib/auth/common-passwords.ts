// Local denylist of the most-leaked passwords. Sourced from public
// breach corpora aggregations (SecLists "rockyou-top-100",
// NCSC "top 100,000 most-used passwords"). Kept inline rather than
// fetched at runtime — predictable, no network dependency, no
// HIBP k-anonymity dance for what is fundamentally a tiny set
// against the long tail.
//
// Why ~100 entries and not 100,000:
//   - Filtering out the top 100 catches the overwhelming bulk of
//     real-world abuse — every credential-stuffing dictionary leads
//     with these. A user who picks "qwerty12345" is meaningfully
//     more vulnerable than one who picks anything else.
//   - Going to 10,000+ blocks legitimate strong-but-leaked phrases
//     and adds memory + lookup cost. The marginal value is small
//     once length and "not all digits" are also enforced.
//   - HIBP k-anonymity API would be the next step if we ever need
//     fuller coverage; it's a backlog item, not a here-and-now thing.
//
// Comparison is normalized (lowercased, trimmed) so users can't
// dodge the check with "Password1" / " password ".

const LEAKED_PASSWORDS_LOWER = new Set<string>([
  // top-25 — every credential-stuffing list leads with these
  '123456',
  '123456789',
  'qwerty',
  'password',
  '12345',
  'qwerty123',
  '1q2w3e',
  '12345678',
  '111111',
  '1234567890',
  '123123',
  '0',
  '1234567',
  'qwerty1',
  'iloveyou',
  '000000',
  'aa12345678',
  'abc123',
  'password1',
  '1234',
  'qwertyuiop',
  '123321',
  'password123',
  '1q2w3e4r5t',
  '666666',

  // very common ru-users pile
  'qwertyu',
  'qwerty12',
  '11111111',
  '12121212',
  '123qwe',
  '1qaz2wsx',
  'q1w2e3r4',
  'q1w2e3r4t5',
  'asdfghjkl',
  'asdf1234',
  'admin',
  'admin123',
  'administrator',
  'root',
  'toor',
  'root123',
  'letmein',
  'welcome',
  'welcome1',
  'welcome123',

  // emoji-of-the-keyboard variants
  '!@#$%^&*',
  '1q2w3e4r',
  'zxcvbnm',
  'asdfgh',

  // pet/dictionary classics
  'monkey',
  'dragon',
  'sunshine',
  'master',
  'shadow',
  'football',
  'baseball',
  'superman',
  'batman',
  'trustno1',
  'starwars',
  'princess',
  'ashley',
  'michael',
  'jordan',
  'jennifer',
  'thomas',
  'hunter',
  'soccer',
  'killer',
  'pepper',
  'jordan23',
  'liverpool',
  'zaq12wsx',

  // RU and translit
  'parol',
  'parol123',
  'парол',
  'пароль',
  '123пароль',
  'parolparol',
  'leshik',
  'samsung',
  'iphone',
  'iphone6',
  'iphone7',

  // year-suffix patterns that survive top-1k cutoff
  'password2024',
  'password2025',
  'password2026',
  '12345abc',
  'abc12345',
  'abcdef',
  'abcdefg',
  'abcd1234',
])

// Returns true if the password (after normalization) is on the denylist.
export function isCommonPassword(password: string): boolean {
  if (typeof password !== 'string') return false
  const normalized = password.trim().toLowerCase()
  if (!normalized) return false
  return LEAKED_PASSWORDS_LOWER.has(normalized)
}

// Exposed for tests / future tuning. Don't import in production code —
// the boolean check is the API.
export function _denylistSize(): number {
  return LEAKED_PASSWORDS_LOWER.size
}
