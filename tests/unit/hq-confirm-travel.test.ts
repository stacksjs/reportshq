/**
 * Where the confirmation code travels, and where the licence does not.
 *
 * An approve link is a URL anyone can mint for any application name. What
 * stops a signed-in person being talked into approving a stranger's link is
 * the confirmation code: it goes to the terminal that asked and nowhere else,
 * and the approve action will not run without it. These read the source for
 * the three places that property can be lost: the route, the link, the page.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

const routes = read('routes/hq.ts')
const page = read('resources/views/cli/connect.stx')
const adapter = read('app/Hq/adapter.ts')

describe('the confirmation code', () => {
  test('is given to the CLI when it starts a connect', () => {
    expect(routes).toContain('confirmCode: await confirmationCode(answer.code)')
  })

  test('is not in the approve link', () => {
    expect(adapter).toContain('approveUrl: code => `${deps.origin()}/cli/connect?code=${encodeURIComponent(code)}`')
  })

  test('is checked before anything is issued, after the session, the Origin and the attempt limit', () => {
    const approve = routes.slice(routes.indexOf('route.post(\'/connect/{code}/approve\''))
    const order = ['sameOrigin(request)', 'requestUser(request)', 'checkConnectLimit(\'approve\'', 'confirmationMatches(code', 'approveConnect(code']
    const positions = order.map(needle => approve.indexOf(needle))
    expect(positions.every(position => position > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    // And the route refuses a request with no session before the handler runs.
    expect(approve).toContain('.middleware(\'auth\')')
  })

  test('is asked for by the page and never rendered or computed by it', () => {
    expect(page).toContain('name="confirm"')
    expect(page).toContain('body: JSON.stringify({ confirm: typed })')
    // If the page could compute or print the code, a person sent the link
    // could approve with no terminal at all.
    expect(page).not.toContain('confirmationCode')
    expect(page).not.toContain('confirmCode')
  })
})

describe('the approve page', () => {
  test('looks a code up only for the signed-in person, scoped to them', () => {
    expect(page).toContain('__describeApproval(connectCode, session.user.id)')
    expect(read('app/Hq/service.ts')).toContain('sqlLicenseStore.findOwnedByApplication(userId, described.app)')
  })

  test('says in words what approving does, in both cases', () => {
    expect(page).toContain('Approving issues a new licence for')
    expect(page).toContain('Approving sends that same licence to the terminal that asked')
  })

  test('never holds a licence: it goes to the terminal, not the browser', () => {
    expect(page).not.toContain('licenseKey')
    expect(page).not.toContain('license.key')
    expect(routes).toContain('return json({ ok: true, project: result.project })')
  })
})

describe('the account page', () => {
  const account = read('resources/views/account.stx')

  test('lists the licences on the server and keeps them out of the client payload', () => {
    expect(account).toContain('await __licensesOwnedBy(user.id)')
    expect(account).toContain('{{ license.key }}')
    expect(account).toContain('defineClientPayload({ twoFactorEnabled })')
    const client = account.slice(account.indexOf('<script client>'), account.indexOf('</script>', account.indexOf('<script client>')))
    expect(client).not.toContain('licenses')
  })
})
