import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { Auth, authCookieName } from '@stacksjs/auth'
import { response } from '@stacksjs/router'
import { clearAuthCookie } from '../../Support/authCookie'

/**
 * Signing out.
 *
 * Replaces the inline `/logout` handler, and keeps its shape rather than the
 * framework default's. This surface is NOT behind the `auth` middleware (see
 * app/Routes.ts), so nothing has resolved the request's user — a bare
 * `Auth.logout()` would revoke `getBearerToken()`, which on a cookie-only fetch
 * is nothing. So the cookie is read here and the token behind it is revoked as
 * well as cleared: clearing alone leaves a working credential in whatever copied
 * it, which is exactly the case somebody signs out to handle.
 */
export default new Action({
  name: 'LogoutAction',
  description: 'Logout from the application',
  method: 'POST',

  async handle(request: RequestInstance) {
    const header = String(request.headers?.get?.('cookie') ?? '')
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

    const clearCookie = clearAuthCookie()

    // A plain server-rendered <form method="POST"> is a full-page navigation,
    // not an XHR, so returning JSON would render the raw payload. Redirect those
    // to /login; XHR/API callers (Accept: application/json, like account.stx's
    // fetch) still get JSON and drive their own redirect.
    const accept = String(request.headers?.get?.('accept') ?? '')
    if (accept.includes('text/html')) {
      return new Response(null, {
        status: 302,
        headers: { 'Location': '/login', 'Set-Cookie': clearCookie },
      })
    }

    return response.json(
      { signedOut: true },
      { status: 200, headers: { 'Set-Cookie': clearCookie } },
    )
  },
})
