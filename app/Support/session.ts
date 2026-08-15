/**
 * Resolving the signed-in user inside a server-rendered page.
 *
 * The cookie is the session. It is written at sign-in and read here, so a page
 * authenticates before it renders rather than painting the app shell and then
 * discovering the visitor is a stranger.
 *
 * One rule this file exists to enforce: **never let the raw token become a
 * top-level binding in a view**. stx publishes top-level server bindings into
 * the HTML as bridge data as soon as the binding's name appears anywhere in a
 * client script, comments included. A view that reads the cookie itself and
 * names the variable `token` therefore ships the session credential in the page
 * source. Calling `userFromCookies(cookies)` keeps the token inside this
 * module, where it is a local and cannot be published.
 */
import { Auth } from '@stacksjs/auth'

/** The cookie the session lives in. Matches what sign-in writes. */
export const SESSION_COOKIE = 'reportshq_token'

export interface SessionUser {
  id: number
  name?: string
  email?: string
}

export interface Session {
  user: SessionUser | null
  /**
   * True when a cookie was presented and did not authenticate, as opposed to
   * there being no cookie at all.
   *
   * The two need different handling and the server cannot tell them apart later:
   * a stale token should be cleared and the visitor sent to sign in, while a
   * first-time visitor should simply be sent there. Bouncing both identically
   * puts anyone whose token expired into a redirect loop.
   */
  stale: boolean
}

/**
 * Resolve the session from a view's `cookies` context local.
 *
 * Never throws. An auth backend that is unreachable renders as signed out,
 * which is the safe direction: the alternative is an error page on every route
 * when a dependency is having a bad minute.
 */
export async function sessionFrom(cookies: Record<string, string> | undefined): Promise<Session> {
  const raw = String(cookies?.[SESSION_COOKIE] ?? '').trim()

  if (!raw)
    return { user: null, stale: false }

  try {
    const found = await Auth.getUserFromToken(raw) as { id?: number | string, name?: string, email?: string } | null

    if (!found?.id)
      return { user: null, stale: true }

    return {
      user: {
        id: Number(found.id),
        name: found.name ? String(found.name) : undefined,
        email: found.email ? String(found.email) : undefined,
      },
      stale: false,
    }
  }
  catch {
    // A token that cannot be checked is treated as stale rather than absent, so
    // the visitor gets it cleared instead of retrying it forever.
    return { user: null, stale: true }
  }
}

/**
 * A query-string reader that tolerates the shapes a view actually receives.
 *
 * stx hands views a `query` that is a URLSearchParams on the serve path and a
 * plain object elsewhere, and a repeated parameter arrives as an array. One
 * reader means a page never has to care which it got.
 */
export function param(query: unknown, name: string): string | undefined {
  if (!query)
    return undefined

  if (typeof (query as URLSearchParams).get === 'function') {
    const value = (query as URLSearchParams).get(name)
    return value === null || value === '' ? undefined : value
  }

  const value = (query as Record<string, unknown>)[name]
  const first = Array.isArray(value) ? value[0] : value

  return first === undefined || first === '' ? undefined : String(first)
}
