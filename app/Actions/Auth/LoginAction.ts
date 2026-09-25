import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, createTwoFactorChallenge, getTwoFactorState } from '@stacksjs/auth'
import { User } from '@stacksjs/orm'
import { response } from '@stacksjs/router'
import { buildAuthCookie, sessionExpiryMinutes } from '../../Support/authCookie'
import { checkSigninLimits, clientAddress } from '../../Support/signin-limits'

/**
 * Signing in.
 *
 * Replaces the inline `/login` handler that used `Auth.login()` (which mints a
 * cookie with no Max-Age — a browser-session credential that also happened to
 * expire in an hour). The session is now stamped once, here, from the "remember
 * me" checkbox: `Auth.loginUsingId(id, { expiresInMinutes })` sets both the
 * `oauth_access_tokens.expires_at` row and, via the returned `expiresIn`, the
 * cookie's Max-Age from the same number, so page and API cannot disagree about
 * when the session ends. See app/Actions/Auth/authCookie.ts.
 *
 * The app's own rules are kept, not the framework default's: credentials are
 * charged against the sign-in rate limiter before they are checked, and every
 * failure — no such account, wrong password, a thrown backend — answers in one
 * voice so the form cannot be used to find out who has an account here.
 */

/**
 * One message for "no such account" and for "wrong password".
 *
 * Distinguishing them turns the sign-in form into a way to find out who has an
 * account here, which for a business analytics product is a list of somebody's
 * customers.
 */
const REFUSED = 'That email and password do not match an account.'

export default new Action({
  name: 'LoginAction',
  description: 'Login to the application',
  method: 'POST',

  async handle(request: RequestInstance) {
    const email = String(request.get('email') ?? '').trim().toLowerCase()
    const password = String(request.get('password') ?? '')

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
      // Verify credentials WITHOUT minting tokens yet — if the account has TOTP
      // 2FA enabled, no token pack should exist until the code is also verified.
      const isValid = await Auth.attempt({ email, password })
      if (!isValid)
        return response.json({ message: REFUSED }, 401)

      // Resolve the row by the SAME lowercased email registration stored under,
      // or a valid credential could authenticate and then fail to find its user.
      const authedUser = await User.where('email', '=', email).first()
      if (!authedUser?.id)
        return response.json({ message: REFUSED }, 401)

      const { enabled: twoFactorEnabled } = await getTwoFactorState(authedUser.id as number)
      if (twoFactorEnabled) {
        const challengeToken = await createTwoFactorChallenge(authedUser.id as number)
        return response.json({
          requires_two_factor: true,
          challenge_token: challengeToken,
        })
      }

      // Session length is set once, here, from the "remember me" checkbox: a
      // week by default, 30 days when checked. See sessionExpiryMinutes.
      const expiresInMinutes = sessionExpiryMinutes(request.get('remember'))
      const result = await Auth.loginUsingId(authedUser.id as number, { expiresInMinutes })
      if (!result?.token)
        return response.json({ message: REFUSED }, 401)

      return response.json(
        { signedIn: true },
        { status: 200, headers: { 'Set-Cookie': buildAuthCookie(result.token, result.expiresIn) } },
      )
    }
    catch {
      // Every failure reads the same from outside, including one thrown by the
      // auth backend, because "something went wrong for you specifically" is
      // still a signal about whether the account exists.
      return response.json({ message: REFUSED }, 401)
    }
  },
})
