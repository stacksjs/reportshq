import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const login = readFileSync(new URL('../../resources/views/login.stx', import.meta.url), 'utf8')

test('both login steps leave display on the hidden-capable form to the browser', () => {
  for (const id of ['signin', 'twofa']) {
    const opening = login.match(new RegExp(`<form id="${id}"[^>]*>`))?.[0] ?? ''
    expect(opening).not.toBe('')
    expect(opening).not.toMatch(/class="[^"]*\b(?:grid|flex|block)\b/)
    expect(login).toContain(`${opening}\n          <div class="grid gap-4">`)
  }
  expect(login).toMatch(/<form id="twofa"[^>]* hidden>/)
})
