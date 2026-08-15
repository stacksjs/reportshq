/**
 * Signing in, signing up, signing out.
 *
 * The only unauthenticated surface in the product, which makes it the only one
 * worth attacking. Two properties matter more than the happy path and are the
 * reason most of these tests exist: it must not become a way to find out who
 * has an account, and it must not accept unlimited guesses.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { featureTest } from '@stacksjs/testing'
import { authCookieName } from '@stacksjs/auth'
import { IDENTIFIER_LIMIT, checkSigninLimits, resetSigninLimits } from '../../app/Support/signin-limits'

const stamp = Date.now()
const email = `auth-${stamp}@reportshq.test`
const password = 'a-long-enough-passphrase'
const emails: string[] = [email]

async function cleanup(): Promise<void> {
  for (const address of emails) {
    const rows = await db.unsafe(`SELECT id FROM users WHERE email = $1`, [address]) as Array<{ id: number }>
    for (const row of rows) {
      try {
        await db.unsafe(`DELETE FROM personal_access_tokens WHERE user_id = $1`, [row.id])
      }
      catch {
        // The table name differs across drivers; the user row is what matters.
      }
      await db.unsafe(`DELETE FROM users WHERE id = $1`, [row.id])
    }
  }
}

beforeAll(cleanup)
afterAll(cleanup)

/** The Set-Cookie value for the session, if the response opened one. */
function sessionCookie(res: { headers?: { get?: (name: string) => string | null } }): string {
  const raw = res.headers?.get?.('set-cookie') ?? ''
  return raw.includes(`${authCookieName()}=`) ? raw : ''
}

describe('POST /api/auth/register', () => {
  test('creates the account and opens a session', async () => {
    const res = await featureTest().post('/api/auth/register', { name: 'Auth Tester', email, password })

    expect(res.status).toBe(201)

    const cookie = sessionCookie(res)
    expect(cookie).toContain(`${authCookieName()}=`)
    // The session credential must never be reachable from a page script: this
    // app's own guard once depended on reading it, and the fix was to stop.
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })

  test('the account is real', async () => {
    const row = (await db.unsafe(`SELECT name FROM users WHERE email = $1`, [email]))?.[0] as { name: string }
    expect(row?.name).toBe('Auth Tester')
  })

  test('the password is not stored as given', async () => {
    const row = (await db.unsafe(`SELECT password FROM users WHERE email = $1`, [email]))?.[0] as { password: string }
    expect(row.password).not.toBe(password)
    expect(row.password.length).toBeGreaterThan(20)
  })

  test('a second account with the same email is refused', async () => {
    const res = await featureTest().post('/api/auth/register', { name: 'Impostor', email, password })
    expect(res.status).toBe(409)
  })

  test('a short password is refused, and says the rule', async () => {
    const address = `short-${stamp}@reportshq.test`
    emails.push(address)

    const res = await featureTest().post('/api/auth/register', { name: 'Short', email: address, password: 'nine char' })

    expect(res.status).toBe(422)
    expect(String((await res.json() as { message?: string }).message ?? '')).toContain('10 characters')
  })

  test('missing fields are refused', async () => {
    const res = await featureTest().post('/api/auth/register', { email: `nope-${stamp}@reportshq.test` })
    expect(res.status).toBe(422)
  })

  test('something that is not an email is refused', async () => {
    const res = await featureTest().post('/api/auth/register', { name: 'x', email: 'not-an-email', password })
    expect(res.status).toBe(422)
  })
})

describe('POST /api/auth/login', () => {
  test('the right password opens a session', async () => {
    const res = await featureTest().post('/api/auth/login', { email, password })

    expect(res.status).toBe(200)
    expect(sessionCookie(res)).toContain('HttpOnly')
  })

  test('the email is not case sensitive', async () => {
    // Somebody's phone capitalises the first letter. That is not a different
    // account and should not read as a wrong password.
    const res = await featureTest().post('/api/auth/login', { email: email.toUpperCase(), password })
    expect(res.status).toBe(200)
  })

  test('a wrong password is refused without a session', async () => {
    const res = await featureTest().post('/api/auth/login', { email, password: 'not-the-passphrase' })

    expect(res.status).toBe(401)
    expect(sessionCookie(res)).toBe('')
  })

  test('an unknown account is refused in exactly the same words', async () => {
    // The important one. A different message, or a different status, turns this
    // endpoint into a way to test whether an address has an account here, which
    // for a business analytics product is a list of somebody's customers.
    const wrong = await featureTest().post('/api/auth/login', { email, password: 'not-the-passphrase' })
    const unknown = await featureTest().post('/api/auth/login', { email: `ghost-${stamp}@reportshq.test`, password })

    expect(unknown.status).toBe(wrong.status)
    expect((await unknown.json() as { message: string }).message).toBe((await wrong.json() as { message: string }).message)
  })

  test('the refusal does not repeat the email back', async () => {
    const res = await featureTest().post('/api/auth/login', { email, password: 'wrong' })
    expect(String((await res.json() as { message?: string }).message ?? '')).not.toContain(email)
  })
})

describe('POST /api/auth/logout', () => {
  test('clears the session cookie', async () => {
    const res = await featureTest().post('/api/auth/logout', {})

    expect(res.status).toBe(200)
    const raw = res.headers?.get?.('set-cookie') ?? ''
    // Max-Age=0 is what actually removes it; an empty value alone leaves a
    // cookie sitting there.
    expect(raw).toContain('Max-Age=0')
  })

  test('revokes the token rather than only forgetting it', async () => {
    const signin = await featureTest().post('/api/auth/login', { email, password })
    const cookie = (signin.headers?.get?.('set-cookie') ?? '').split(';')[0] ?? ''
    const token = cookie.split('=')[1] ?? ''
    expect(token).not.toBe('')

    await featureTest().withHeaders({ Cookie: cookie }).post('/api/auth/logout', {})

    // Signing out is what somebody does when a credential may have been
    // copied, so forgetting it locally is not enough.
    const { Auth } = await import('@stacksjs/auth')
    expect(await Auth.getUserFromToken(decodeURIComponent(token))).toBeFalsy()
  })
})

describe('sign-in rate limits', () => {
  const address = '203.0.113.9'
  const target = `limited-${stamp}@reportshq.test`

  beforeAll(async () => {
    await resetSigninLimits(target, address)
  })

  afterAll(async () => {
    await resetSigninLimits(target, address)
  })

  test('allows a reasonable number of attempts and then stops', async () => {
    for (let attempt = 0; attempt < IDENTIFIER_LIMIT; attempt++)
      expect((await checkSigninLimits(target, address)).ok).toBeTrue()

    const refused = await checkSigninLimits(target, address)
    expect(refused.ok).toBeFalse()
    expect(refused.retryAfter).toBeGreaterThan(0)
  })

  test('another account is unaffected by one account being locked', async () => {
    // Otherwise anybody could lock anybody else out by guessing at their email.
    const other = `bystander-${stamp}@reportshq.test`
    try {
      expect((await checkSigninLimits(other, '198.51.100.4')).ok).toBeTrue()
    }
    finally {
      await resetSigninLimits(other, '198.51.100.4')
    }
  })

  test('the limit is charged whether or not the guess was right', async () => {
    // Charging only failures lets an attacker probe forever as long as they
    // occasionally guess right, and leaks which guesses were close.
    const probe = `probe-${stamp}@reportshq.test`
    try {
      for (let attempt = 0; attempt < IDENTIFIER_LIMIT; attempt++)
        await checkSigninLimits(probe, '198.51.100.5')

      expect((await checkSigninLimits(probe, '198.51.100.5')).ok).toBeFalse()
    }
    finally {
      await resetSigninLimits(probe, '198.51.100.5')
    }
  })
})
