import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const login = readFileSync(new URL('../../resources/views/login.stx', import.meta.url), 'utf8')

/*
 * Keyed off each form's `:hidden` step expression, not an `id`.
 *
 * Both forms carried `id="signin"` / `id="twofa"` only so the DOM-walking
 * sign-in script could grab them, and the ids went when that script became
 * client state. The step expression is what tells the two forms apart now. The
 * assertions themselves are unchanged in intent: neither form may set its own
 * display in `class`, the grid lives on the wrapper div inside it, and the 2FA
 * form keeps a STATIC `hidden` so a page that never hydrates still looks the
 * way it did -- which is the whole reason these are `:hidden` and not `@if`
 * (see the note in login.stx).
 */
test('both login steps leave display on the hidden-capable form to the browser', () => {
  for (const step of ['credentials', 'twofa']) {
    const opening = login.match(new RegExp(`<form[^>]*:hidden="step\\(\\) !== '${step}'"[^>]*>`))?.[0] ?? ''
    expect(opening).not.toBe('')
    expect(opening).not.toMatch(/class="[^"]*\b(?:grid|flex|block)\b/)
    expect(login).toContain(`${opening}\n          <div class="grid gap-4">`)
  }
  // A bare `hidden`, not the `:hidden` binding beside it: whitespace before the
  // name, so ` :hidden=` cannot satisfy this.
  const twofa = login.match(/<form[^>]*:hidden="step\(\) !== 'twofa'"[^>]*>/)?.[0] ?? ''
  expect(twofa).toMatch(/\shidden[\s>]/)
})
