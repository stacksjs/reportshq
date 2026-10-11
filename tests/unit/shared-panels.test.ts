import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { processDirectives } from '../../node_modules/@stacksjs/stx/dist/process.js'
import theme from '../../config/crosswind'
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const root = resolve(import.meta.dir, '../..')
const cardPath = resolve(root, 'node_modules/@stacksjs/components/src/ui/card/Card.stx')

// Exercise the real page markup and installed components with explicit view
// data. Session lookup and report queries are separate backend responsibilities;
// this suite does not open a database or manufacture an authenticated session.
async function renderView(view: string, data: Record<string, unknown>) {
  const file = resolve(root, `resources/views/${view}.stx`)
  const template = readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
  const dependencies = new Set<string>()
  const rendered = await processDirectives(template, {
    ...data,
    __importedComponents: new Map([['card', cardPath]]),
  }, file, {
    componentsDir: resolve(root, 'resources/components'),
    partialsDir: resolve(root, 'resources/partials'),
  }, dependencies)
  const html = rendered.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
  expect(html).not.toContain('[Component Error')
  expect(html).not.toContain('[Foreach Error')
  expect(html).not.toContain('<Card')
  return { html, dependencies }
}

describe('shared report panels', () => {
  test('account panels use Card while keeping profile values and the native sign-out control', async () => {
    const { html, dependencies } = await renderView('account', {
      user: { name: 'Mara Santos', email: 'mara@example.test' },
      since: '18 September 2026',
    })
    expect([...dependencies]).toContain(cardPath)
    expect(html).toContain('Mara Santos')
    expect(html).toContain('mara@example.test')
    expect(html).toContain('18 September 2026')
    expect(html).toMatch(/<button\s+id="signout"\s+type="button"/)
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain('You are not signed in.')
  })

  test('signed-out account retains its sign-in link without exposing profile fields', async () => {
    const { html, dependencies } = await renderView('account', { user: null, since: '' })
    expect([...dependencies]).toContain(cardPath)
    expect(html).toContain('You are not signed in.')
    expect(html).toContain('href="/login"')
    expect(html).not.toContain('id="signout"')
    expect(html).not.toContain('Member since')
  })

  test('report cards retain list/link semantics and escaped report text', async () => {
    const { html, dependencies } = await renderView('reports/index', {
      user: { name: 'Mara Santos' },
      reports: [{ slug: 'weekly-users', name: 'Users & teams', description: '<Review>', status: 'published' }],
      notice: null,
    })
    expect([...dependencies]).toContain(cardPath)
    expect(html.match(/<li\b/g)).toHaveLength(1)
    expect(html).toContain('href="/reports/weekly-users"')
    expect(html).toContain('Users &amp; teams')
    expect(html).toContain('&lt;Review&gt;')
    expect(html).toContain('published')
    expect(html).not.toContain('role="button"')
  })

  test('account panel styling keeps its original inset and unclipped focus', async () => {
    const engine = await loadCssEngine()
    if (!engine) throw new Error('The installed STX CSS engine is required')
    const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
    generator.generate('report-action-panel')
    const css = generator.toCSS(false, false)
    expect(css).toContain('padding: 1.25rem !important')
    expect(css).toContain('background-color: transparent !important')
    expect(css).toContain('overflow: visible !important')
  })

  test('optional profile and report text can be absent inside shared panels', async () => {
    const account = await renderView('account', { user: { name: 'Mara', email: 'mara@example.test' }, since: '' })
    expect(account.html).toContain('id="signout"')
    expect(account.html).not.toContain('Member since')
    const reports = await renderView('reports/index', {
      user: { name: 'Mara' },
      reports: [{ slug: 'users', name: 'Users', status: 'draft' }],
      notice: null,
    })
    expect(reports.html).toContain('href="/reports/users"')
    expect(reports.html).not.toContain('undefined')
  })

  for (const [user, message] of [
    [null, 'Sign in to see the reports this application runs on its own tables.'],
    [{ name: 'Mara' }, 'Nothing described yet. Add a model to config/reportshq.ts.'],
  ] as const) {
    test(`empty reports: ${user ? 'signed in' : 'signed out'}`, async () => {
      const { html } = await renderView('reports/index', { user, reports: [], notice: null })
      expect(html).toContain(message)
      expect(html).not.toContain('<li')
      expect(html).not.toContain('rounded-panel')
    })
  }
})
