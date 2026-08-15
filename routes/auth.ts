import type { EnhancedRequest } from '@stacksjs/bun-router'
import { Auth, authCookie, authCookieName, clearAuthCookie, passwordResets, register } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { response, route } from '@stacksjs/router'
import { clientAddress } from '../app/Events/limits'
import { checkSigninLimits } from '../app/Support/signin-limits'

/**
 * Signing in, signing up, signing out.
 *
 * Not behind the `auth` middleware, for the obvious reason. Everything else in
 * the app is, which is what makes this the only unauthenticated surface worth
 * attacking, so it carries its own rate limits and says as little as possible
 * about what it knows.
 *
 * The session is an httpOnly cookie carrying the same personal access token the
 * API uses, built by the framework's `authCookie()`. Naming, expiry and the
 * Secure flag are all decided there, so a page and its API calls cannot end up
 * disagreeing about which cookie the session lives in - a disagreement that has
 * already cost this project an afternoon once.
 */

/** The JSON body. `request.input()` does not surface JSON fields on this path. */
async function body(request: EnhancedRequest): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text()
    if (!raw)
      return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

function field(payload: Record<string, unknown>, name: string): string {
  return String(payload[name] ?? '').trim()
}

/**
 * One message for "no such account" and for "wrong password".
 *
 * Distinguishing them turns the sign-in form into a way to find out who has an
 * account here, which for a business analytics product is a list of somebody's
 * customers.
 */
const REFUSED = 'That email and password do not match an account.'

/** The Set-Cookie header for a fresh session. */
function sessionCookie(token: string): Record<string, string> {
  return { 'Set-Cookie': authCookie(token) }
}

route.post('/register', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const name = field(payload, 'name')
  const email = field(payload, 'email').toLowerCase()
  const password = String(payload.password ?? '')

  if (!name || !email || !password)
    return response.json({ message: 'Name, email and password are all needed.' }, 422)

  if (!email.includes('@') || email.length > 200)
    return response.json({ message: 'That does not look like an email address.' }, 422)

  // Long rather than complex. Character-class rules push people toward
  // Passw0rd! and away from a passphrase, and length is what actually costs an
  // attacker anything.
  if (password.length < 10)
    return response.json({ message: 'Use at least 10 characters.' }, 422)

  // Checked before writing, so the answer is "that email is taken" rather than
  // a unique-constraint error surfacing as a 500.
  const existing = (await db.unsafe(`SELECT id FROM users WHERE email = $1`, [email]))?.[0]
  if (existing)
    return response.json({ message: 'There is already an account with that email.' }, 409)

  try {
    const session = await register({ name, email, password } as never)
    const token = String((session.token as { plainTextToken?: string })?.plainTextToken ?? session.token)

    return response.json({ registered: true }, { status: 201, headers: sessionCookie(token) })
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 422)
  }
}).skipCsrf()

route.post('/login', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const email = field(payload, 'email').toLowerCase()
  const password = String(payload.password ?? '')

  if (!email || !password)
    return response.json({ message: REFUSED }, 422)

  // Charged before the password is checked, so a right guess and a wrong one
  // cost the same and the endpoint does not leak which was which through how
  // quickly it answers.
  const limit = await checkSigninLimits(email, clientAddress(request))
  if (!limit.ok) {
    return response.json(
      { message: 'Too many attempts. Try again in a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  try {
    const session = await Auth.login({ email, password } as never)
    const token = String((session?.token as { plainTextToken?: string })?.plainTextToken ?? session?.token ?? '')

    if (!token)
      return response.json({ message: REFUSED }, 401)

    return response.json({ signedIn: true }, { status: 200, headers: sessionCookie(token) })
  }
  catch {
    // Every failure reads the same from outside, including one thrown by the
    // auth backend, because "something went wrong for you specifically" is
    // still a signal about whether the account exists.
    return response.json({ message: REFUSED }, 401)
  }
}).skipCsrf()

/**
 * Ask for a reset link.
 *
 * Always answers the same, whether or not the address has an account. A
 * different answer turns this into a way to find out who is a customer, which
 * is the same reason /login refuses in one voice.
 *
 * Rate limited on the same windows as sign-in, since it sends mail on demand
 * and is otherwise a way to have us deliver unwanted email to anybody.
 */
route.post('/forgot', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const email = field(payload, 'email').toLowerCase()

  const sent = { message: 'If that email has an account, a reset link is on its way.' }

  if (!email || !email.includes('@'))
    return response.json(sent)

  const limit = await checkSigninLimits(email, clientAddress(request))
  if (!limit.ok) {
    return response.json(
      { message: 'Too many attempts. Try again in a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  try {
    await passwordResets(email).sendEmail()
  }
  catch (error) {
    // Logged, not surfaced. Whether the send failed and whether the account
    // exists are both things this endpoint must not reveal, and a person
    // staring at a different message would learn one of them.
    console.error('[auth] password reset send failed:', (error as Error).message)
  }

  return response.json(sent)
}).skipCsrf()

/**
 * Use a reset link.
 *
 * The framework owns the token: it hashes it, checks the expiry, sets the new
 * password and revokes every existing session and token for the account. That
 * last part is the one worth not reimplementing - somebody resetting a password
 * is often doing it because somebody else has their old one.
 */
route.post('/reset', async (request: EnhancedRequest) => {
  const payload = await body(request)
  const email = field(payload, 'email').toLowerCase()
  const token = field(payload, 'token')
  const password = String(payload.password ?? '')

  if (!email || !token)
    return response.json({ message: 'That reset link is not valid.' }, 422)

  if (password.length < 10)
    return response.json({ message: 'Use at least 10 characters.' }, 422)

  try {
    const result = await passwordResets(email).resetPassword(token, password)

    if (!result.success) {
      // The framework's own message, which distinguishes an expired link from
      // a wrong one. Both are safe to say: the person is holding the link.
      return response.json({ message: result.message || 'That reset link is not valid or has expired.' }, 422)
    }

    return response.json({ reset: true })
  }
  catch (error) {
    return response.json({ message: (error as Error).message }, 422)
  }
}).skipCsrf()

route.post('/logout', async (request: EnhancedRequest) => {
  // The cookie is read here rather than trusting a body, and the token is
  // revoked as well as cleared. Clearing alone leaves a working credential in
  // whatever copied it, which is exactly the case somebody signs out to handle.
  const header = request.headers.get('cookie') ?? ''
  const wanted = authCookieName()

  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1)
      continue
    if (pair.slice(0, index).trim() !== wanted)
      continue

    try {
      await Auth.revokeToken(decodeURIComponent(pair.slice(index + 1).trim()))
    }
    catch {
      // A token that cannot be revoked is already unusable; the cookie still
      // has to go.
    }
  }

  return response.json({ signedOut: true }, { status: 200, headers: { 'Set-Cookie': clearAuthCookie() } })
}).skipCsrf()
