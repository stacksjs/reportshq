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
import { Auth, authCookieName } from '@stacksjs/auth'

/**
 * The cookie the session lives in, resolved from the framework rather than
 * spelled out here.
 *
 * The `auth` middleware reads whatever `authCookieName()` returns, so hardcoding
 * a second name is how a page authenticates happily while every request it makes
 * comes back 401. That is exactly what happened: the builder rendered, and its
 * save endpoint refused every call.
 */
export function sessionCookieName(): string {
  return authCookieName()
}

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
  const raw = String(cookies?.[sessionCookieName()] ?? '').trim()

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

/**
 * The authenticated user on an API request.
 *
 * The `auth` middleware stamps `request._authenticatedUser`, not `request.user`,
 * so a handler reading the latter sees nothing and answers 401 or 404 for a
 * request that authenticated perfectly. That cost an afternoon: the middleware
 * passed, the route refused, and the two facts looked unrelated.
 *
 * Both are checked here, in one place, so a change on either side does not send
 * every route hunting for it again. The id is coerced once, because the
 * framework types it as `string | number` and everything downstream compares it
 * against an integer column.
 */
export function requestUser(request: unknown): SessionUser | null {
  const candidate = request as { _authenticatedUser?: { id?: number | string, name?: string, email?: string }, user?: { id?: number | string, name?: string, email?: string } }
  const found = candidate?._authenticatedUser ?? candidate?.user

  const id = Number(found?.id ?? 0)
  if (!Number.isFinite(id) || id <= 0)
    return null

  return {
    id,
    name: found?.name ? String(found.name) : undefined,
    email: found?.email ? String(found.email) : undefined,
  }
}
