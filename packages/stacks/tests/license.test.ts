import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { License, LICENSE_PREFIX } from '../src/license'

describe('the licence', () => {
  it('accepts a well formed key and says nothing', () => {
    const license = new License(LICENSE_PREFIX + 'a1b2'.repeat(8))

    expect(license.valid()).toBe(true)
    expect(license.notice()).toBeNull()
  })

  it('tells no key apart from the wrong key', () => {
    expect(new License().notice()).toContain('Unlicensed')
    expect(new License('sk_live_not_ours').notice()).toContain('not in the expected format')
  })

  it('says reports work either way', () => {
    expect(new License().notice()).toContain('in full')
    expect(new License('sk_live_not_ours').notice()).toContain('unaffected')
  })

  it('never reaches the network', () => {
    // Asserted against the source rather than the behaviour: the guarantee is
    // that there is no code here that could, under any configuration.
    const source = readFileSync(new URL('../src/license.ts', import.meta.url), 'utf8')

    for (const call of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'http.', 'https.', 'Bun.connect'])
      expect(source).not.toContain(call)
  })
})
