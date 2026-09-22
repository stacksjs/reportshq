import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, consumeTwoFactorChallenge, verifyTwoFactorLoginCode } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { buildAuthCookie, sessionExpiryMinutes } from './authCookie'

/**
 * Second step of a sign-in for an account with TOTP 2FA enabled.
 *
 * Dormant today: nothing in this app sets `two_factor_enabled`, so LoginAction
 * never emits the `requires_two_factor` challenge that would bring a visitor
 * here. It ships anyway, correct, so the day an enrollment surface is added a
 * 2FA account cannot lock itself out — the login page already knows to reveal a
 * code form and POST it here. The 2FA columns/table are provisioned by the
 * framework's auth migrations, so this authenticates rather than throwing even
 * while unreachable.
 *
 * Same cookie contract as LoginAction: the tier the visitor chose at step one is
 * re-sent with the code and stamped into both the token row and the cookie here,
 * so a 2FA account is not silently downgraded to the baseline week.
 */
export default new Action({
  name: 'VerifyTwoFactorLoginAction',
  description: 'Exchange a LoginAction 2FA challenge + TOTP code for a session',
  method: 'POST',

  async handle(request: RequestInstance) {
    const challengeToken = String(request.get('challenge_token') ?? '').trim()
    const code = String(request.get('code') ?? '').trim()

    if (!challengeToken || !code)
      return response.json({ message: 'Enter the 6-digit code from your authenticator app.' }, 422)

    // Single-use: a second attempt with the same challenge token (right code or
    // wrong) must start over from LoginAction, not retry.
    const userId = await consumeTwoFactorChallenge(challengeToken)
    if (!userId)
      return response.json({ message: 'This sign-in has expired - please sign in again.' }, 401)

    const valid = await verifyTwoFactorLoginCode(userId, code)
    if (!valid)
      return response.json({ message: 'That code did not match - please sign in again.' }, 401)

    // Carry the "remember me" tier chosen at step one through to the session
    // issued here. The login page re-sends the checkbox with the code.
    const expiresInMinutes = sessionExpiryMinutes(request.get('remember'))
    const result = await Auth.loginUsingId(userId, { expiresInMinutes })
    if (!result?.token)
      return response.json({ message: 'Could not complete sign-in - please sign in again.' }, 401)

    return response.json(
      { signedIn: true },
      { status: 200, headers: { 'Set-Cookie': buildAuthCookie(result.token, result.expiresIn) } },
    )
  },
})
