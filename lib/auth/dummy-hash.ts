import { hashPassword, verifyPassword } from '@/lib/auth/password'

// Module-load dummyHash for constant-time login (per /plan-eng-review D3).
//
// When `getAccountByEmail` returns null OR account is disabled, the login
// route still needs to call `verifyPassword` so an attacker cannot
// distinguish "unknown email" from "wrong password" by wall-clock time.
// We compute one bcrypt-hashed dummy at module load and reuse it forever.
//
// Cost: ~250ms once at process start (autodeploy swap absorbs this; local
// dev pays it once per `npm run dev` boot). Variance across runs on the
// same hash is ±10ms — within CI noise floor.
//
// The dummy plaintext is deliberately recognizable so it can never collide
// with a real password by accident.

const DUMMY_PLAINTEXT = 'lc-dummy-not-a-real-password'

let dummyHashPromise: Promise<string> | null = null

function ensureDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(DUMMY_PLAINTEXT)
  }
  return dummyHashPromise
}

// Top-level kick so the hash is being computed before the first request
// touches the login route. Errors are swallowed here — `getDummyHash` will
// throw on use if hashing fails, which is the right surface.
ensureDummyHash().catch(() => {
  dummyHashPromise = null
})

export async function getDummyHash(): Promise<string> {
  return ensureDummyHash()
}

// Convenience: always run a real bcrypt cycle. If `realHash` is provided,
// verify against it; otherwise verify against the dummy. Wall-clock budget
// is identical across both branches.
export async function constantTimeVerifyPassword(
  password: string,
  realHash: string | null | undefined,
): Promise<boolean> {
  const hashToCheck = realHash || (await getDummyHash())
  const matched = await verifyPassword(password, hashToCheck)
  // If we used the dummy hash, the password obviously won't match — but
  // we still ran the full bcrypt cycle, which is the whole point.
  return matched && Boolean(realHash)
}
