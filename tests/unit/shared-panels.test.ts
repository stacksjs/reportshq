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

  /*
   * The four use-case pages close with the same call to action, which was four
   * byte-identical hand-rolled panels. On <Card> the one thing that does not
   * come from the component is the radius: these are marketing pages at 16px,
   * not the 12px `rounded-panel` the dashboard uses, and className is appended
   * to the class attribute rather than to the stylesheet, so only `!` decides
   * it. Without that the panels would quietly round to 12px the next time
   * crosswind changed its emission order.
   */
  const useCases = ['agencies', 'commerce', 'content', 'saas-users'] as const

  for (const slug of useCases) {
    test(`the ${slug} call to action is a Card and keeps its 16px radius`, async () => {
      // The harness strips <script server>, so the two lists the layout walks
      // have to come in as data; the copy itself is what the page hard-codes.
      const { html, dependencies } = await renderView(`use-cases/${slug}`, {
        breadcrumbs: [{ label: 'Home', href: '/' }],
        breadcrumbWidth: 'max-w-3xl',
        sections: [],
        page: { title: 'Use case', description: '' },
      })
      expect([...dependencies]).toContain(cardPath)
      expect(html).toContain('rounded-panel')
      expect(html).toContain('!rounded-2xl')
      expect(html).toContain('href="/register"')
      expect(html).toContain('Start free')
      // The hand-rolled panel is gone rather than wrapped in the component.
      expect(html).not.toContain('p-8 bg-panel border border-line rounded-2xl')
    })
  }

  test('rounded-2xl beats the component radius because it is marked important', async () => {
    const engine = await loadCssEngine()
    if (!engine)
      throw new Error('The installed STX CSS engine is required')
    const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
    generator.generate('!rounded-2xl')
    generator.generate('rounded-panel')
    const css = generator.toCSS(false, false)
    expect(css).toContain('border-radius: 1rem !important')
    expect(css).toContain('border-radius: 0.75rem;')
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
