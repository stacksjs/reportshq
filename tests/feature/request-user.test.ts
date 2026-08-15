/**
 * How a route reads the authenticated user.
 *
 * The `auth` middleware stamps `request._authenticatedUser`, not `request.user`.
 * A handler reading the latter sees nothing, so a request that authenticated
 * perfectly is answered 401 or 404 - the middleware passes, the route refuses,
 * and the two facts look unrelated. That cost real time on the builder, where
 * every save came back "Report not found" for a report that was right there.
 */
import { describe, expect, test } from 'bun:test'
import { requestUser } from '../../app/Support/session'

describe('requestUser', () => {
  test('reads the property the auth middleware actually stamps', () => {
    expect(requestUser({ _authenticatedUser: { id: 7 } })?.id).toBe(7)
  })

  test('still reads `user`, so a change on either side does not break routes', () => {
    expect(requestUser({ user: { id: 9 } })?.id).toBe(9)
  })

  test('prefers the middleware property when both are present', () => {
    expect(requestUser({ _authenticatedUser: { id: 7 }, user: { id: 9 } })?.id).toBe(7)
  })

  test('coerces the id, because the framework types it as string or number', () => {
    // Everything downstream compares it against an integer column.
    expect(requestUser({ _authenticatedUser: { id: '42' } })?.id).toBe(42)
  })

  test('an unauthenticated request resolves to null rather than a zero id', () => {
    // A zero id would sail through a truthiness check and then match nothing,
    // which is a harder bug to see than a null.
    expect(requestUser({})).toBeNull()
    expect(requestUser(null)).toBeNull()
    expect(requestUser({ user: {} })).toBeNull()
    expect(requestUser({ _authenticatedUser: { id: 0 } })).toBeNull()
    expect(requestUser({ _authenticatedUser: { id: 'not-a-number' } })).toBeNull()
  })

  test('carries name and email when they are there', () => {
    const user = requestUser({ _authenticatedUser: { id: 3, name: 'Ana', email: 'ana@example.com' } })
    expect(user?.name).toBe('Ana')
    expect(user?.email).toBe('ana@example.com')
  })
})
