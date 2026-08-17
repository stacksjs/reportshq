import { describe, expect, it } from 'bun:test'
import { defaults, resolveConfig } from '../src/config'

describe('configuration', () => {
  it('needs nothing but the models', () => {
    const resolved = resolveConfig({ models: {} })

    expect(resolved.timezone).toBe('UTC')
    expect(resolved.routes.prefix).toBe('/reports')
    expect(resolved.license).toBeNull()
  })

  it('leaves the JSON surface off until it is asked for', () => {
    // A decision, not a default. An application that only wants the pages
    // should not have to turn an API off.
    expect(defaults.api.enabled).toBe(false)
    expect(resolveConfig({ models: {} }).api.enabled).toBe(false)
    expect(resolveConfig({ models: {}, api: { enabled: true } }).api.enabled).toBe(true)
  })

  it('keeps the share route unguarded by default', () => {
    // The one surface that must work for somebody with no account. A guard
    // here does not harden it, it breaks the link for the people it was sent
    // to, and it fails silently because the sender can still see the report.
    expect(resolveConfig({ models: {} }).routes.shareMiddleware).toEqual([])
    expect(resolveConfig({ models: {} }).routes.middleware).toEqual(['auth'])
  })

  it('merges a partial section without dropping the rest of it', () => {
    const resolved = resolveConfig({ models: {}, routes: { prefix: '/insights' } })

    expect(resolved.routes.prefix).toBe('/insights')
    expect(resolved.routes.middleware).toEqual(['auth'])
  })
})
