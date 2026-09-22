import type { EnhancedRequest } from '@stacksjs/bun-router'
import { passwordResets } from '@stacksjs/auth'
import { response, route } from '@stacksjs/router'
import { checkSigninLimits, clientAddress } from '../app/Support/signin-limits'

/**
 * Signing in, signing up, signing out.
 *
 * Not behind the `auth` middleware, for the obvious reason. Everything else in
 * the app is, which is what makes this the only unauthenticated surface worth
 * attacking, so it carries its own rate limits and says as little as possible
 * about what it knows.
 *
 * The session is an httpOnly cookie carrying the same personal access token the
 * API uses. It is minted by the shared app/Actions/Auth layer (LoginAction,
 * RegisterAction, VerifyTwoFactorLoginAction) through buildAuthCookie, which
 * stamps the cookie's Max-Age from the same per-login number as the token row's
 * expiry, so a page and its API calls cannot end up disagreeing about which
 * cookie the session lives in or when it ends — a disagreement that has already
 * cost this project an afternoon once.
 *
 * The four session actions live in app/Actions/Auth so every entry point into
 * an authenticated session shares one cookie contract; only the two public,
 * session-less endpoints (/forgot, /reset) stay inline here. All auth routes
 * keep `.skipCsrf()`: the cookie is SameSite=Lax and these views send no CSRF
 * token, so cross-site forgery is blocked by the cookie policy, not a token.
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

route.post('/register', 'Actions/Auth/RegisterAction').skipCsrf()

route.post('/login', 'Actions/Auth/LoginAction').skipCsrf()

route.post('/verify-two-factor-login', 'Actions/Auth/VerifyTwoFactorLoginAction').skipCsrf()

route.post('/logout', 'Actions/Auth/LogoutAction').skipCsrf()

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
