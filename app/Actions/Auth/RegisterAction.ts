import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { register } from '@stacksjs/auth'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { buildAuthCookie } from '../../Support/authCookie'

/**
 * Creating an account.
 *
 * Replaces the inline `/register` handler. Same rules as before — a length-only
 * password policy, an email-taken pre-check so the answer is "that email is
 * taken" rather than a unique-constraint 500, and email lowercased so sign-in
 * resolves the same row later. The only account this creates is the person's
 * own; teammates arrive through project invites, so there is deliberately no
 * team creation here (unlike statushq's RegisterAction).
 *
 * The one behavioural change is the cookie: the freshly-issued token is mirrored
 * into the HttpOnly `auth-token` cookie through the shared buildAuthCookie at
 * the 7-day baseline (no "remember me" on signup), so the Max-Age matches the
 * token row instead of the old no-Max-Age, one-hour cookie.
 */
export default new Action({
  name: 'RegisterAction',
  description: 'Register a new user',
  method: 'POST',

  async handle(request: RequestInstance) {
    const name = String(request.get('name') ?? '').trim()
    const email = String(request.get('email') ?? '').trim().toLowerCase()
    const password = String(request.get('password') ?? '')

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

      return response.json(
        { registered: true },
        { status: 201, headers: { 'Set-Cookie': buildAuthCookie(token) } },
      )
    }
    catch (error) {
      return response.json({ message: (error as Error).message }, 422)
    }
  },
})
