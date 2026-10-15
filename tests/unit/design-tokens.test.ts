/**
 * The design tokens, and the fact that they are declared in the typed config
 * rather than a stylesheet (stx-standards rule 3, §11.2).
 *
 * They lived in public/tokens.css, linked from config/ui.ts, on a stated
 * justification that turned out to be false:
 *
 *   "It is deliberately NOT in config/crosswind.ts `preflights` [...] on the
 *    stx serve path `preflights` is spread into the generator config and then
 *    never emitted, so a token placed there reaches no page at all. Verified
 *    in loghq the hard way; inherited here rather than rediscovered."
 *
 * It was true when loghq first wrote it -- the old dev-server merge read only
 * `theme.extend`, `safelist` and `shortcuts` -- and stacksjs/stx #1867 unified
 * the two render paths onto one merge. loghq's own config had already been
 * corrected; only the inherited copy here still said it, and it was the reason
 * 82 declarations sat outside the config. This file is the part that cannot be
 * inherited: it measures the claim on the installed engine instead.
 *
 * `scripts/verify-tokens.ts` guards the other half -- that every utility maps
 * onto a property declared in all four theme blocks, and that the contrast
 * ratios quoted in the reference page are the ones those hex values produce.
 * This file guards that the block reaches a page at all.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import theme from '../../config/crosswind'
// The installed STX package does not export these subpaths by bare specifier.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const ROOT = join(import.meta.dir, '../..')
const PUBLIC = join(ROOT, 'public')

const ENTRIES = ((theme as { preflights?: { getCSS: () => string }[] }).preflights ?? [])
  .map(entry => entry.getCSS())
const TOKENS = ENTRIES.find(entry => entry.includes('--series-1:')) ?? ''

/** The whole sheet, merged the way the render path merges it. */
async function generate(): Promise<string> {
  const engine = await loadCssEngine()
  if (!engine)
    throw new Error('The installed STX CSS engine is required')
  const merged = mergeCssConfig(engine.defaultConfig || engine.config, theme)
  return new engine.CSSGenerator(merged.config).toCSS(merged.includePreflight, false)
}

describe('one declaration site', () => {
  test('§11.2: no stylesheet under public/ declares a design token', () => {
    /*
     * The standard's own check, with one exemption that is not hand-written
     * source. public/reportshq-charts.css is build output: `bun run
     * build:charts` concatenates the chart components' compiled @scope rules
     * with resources/components/charts/{charts,grid}.css into it, and it ships
     * to consumers who have no crosswind at all. Its four declarations are
     * `--rhq-*` aliases that READ the tokens below through var() with a
     * fallback, so they are consumers of this file, not a second source.
     */
    const generated = new Set(['reportshq-charts.css'])
    const offenders = readdirSync(PUBLIC)
      .filter(name => name.endsWith('.css') && !generated.has(name))
      .flatMap((name) => {
        const declarations = [...readFileSync(join(PUBLIC, name), 'utf8')
          .matchAll(/^\s*(--[a-z][\w-]*)\s*:/gm)].map(match => match[1])
        return declarations.length > 0 ? [`${name}: ${declarations.join(', ')}`] : []
      })
    expect(offenders).toEqual([])

    // And the aliases in the exempt file really are aliases.
    const charts = readFileSync(join(PUBLIC, 'reportshq-charts.css'), 'utf8')
    for (const match of charts.matchAll(/^\s*(--[a-z][\w-]*)\s*:\s*([^;}\n]+)/gm))
      expect({ token: match[1], readsATokenBelow: match[2].includes('var(--') }).toEqual({ token: match[1], readsATokenBelow: true })
  })

  test('nothing links a stylesheet that no longer exists', () => {
    // config/ui.ts linked /tokens.css into every page's <head>. Deleting the
    // file without the link is a 404 on every route and an unstyled site.
    const ui = readFileSync(join(ROOT, 'config/ui.ts'), 'utf8')
    expect(ui).not.toContain('tokens.css')
    for (const match of ui.matchAll(/rel: 'stylesheet', href: '(\/[^']+)'/g))
      expect({ href: match[1], onDisk: readdirSync(PUBLIC).includes(match[1].slice(1)) }).toEqual({ href: match[1], onDisk: true })
  })
})

describe('the claim that kept them out of the config', () => {
  test('a preflight IS emitted by the installed engine', async () => {
    /*
     * The measurement, not the changelog. A probe entry added to the config in
     * memory has to come back out of toCSS(); if it does not, the old note was
     * right after all and this whole arrangement is dead CSS.
     */
    const engine = await loadCssEngine()
    if (!engine)
      throw new Error('The installed STX CSS engine is required')
    const probe = { ...theme, preflights: [...ENTRIES.map(css => ({ getCSS: () => css })), { getCSS: () => ':root { --probe-token: #abcdef; }' }] }
    const merged = mergeCssConfig(engine.defaultConfig || engine.config, probe)
    expect(merged.includePreflight).toBe(true)
    const css = new engine.CSSGenerator(merged.config).toCSS(merged.includePreflight, false)
    expect(css).toContain('--probe-token: #abcdef')
  })

  test('all four theme blocks come back out of the generated sheet', async () => {
    const css = await generate()
    for (const selector of [':root {', '@media (prefers-color-scheme: dark)', ':root[data-theme=\'dark\']', ':root[data-theme=\'light\']'])
      expect({ selector, emitted: css.includes(selector) }).toEqual({ selector, emitted: true })

    // One value out of each, so an empty block would not pass.
    expect(css).toContain('--bg: #fcfbf9')
    expect(css).toContain('--bg: #0b0d12')
    expect(css).toContain('--series-1: #6860f2')
    expect(css).toContain('--series-1: #6963ec')

    // An explicit choice has to beat the OS preference, which is source order
    // inside one preflight rather than two stylesheets racing.
    expect(css.indexOf(':root[data-theme=\'dark\']')).toBeGreaterThan(css.indexOf('prefers-color-scheme'))
  })

  test('the chrome rules that travelled with them survive too', async () => {
    const css = await generate()
    for (const rule of ['.num {', '@keyframes rhq-pulse', 'prefers-reduced-motion', ':root[data-theme=\'light\'] .theme-btn .ic-sun'])
      expect({ rule, emitted: css.includes(rule) }).toEqual({ rule, emitted: true })

    /*
     * Measured in a browser on the built site rather than only here: with
     * data-theme flipped, --bg computes #fcfbf9 / #0b0d12 and color-scheme
     * light / dark; a `.num` probe computes Geist Mono with tabular-nums; and
     * `text-accent` added to <body> takes its colour from rgb(242,244,248) to
     * rgb(143,162,255). That last one is the one thing the move changed: these
     * rules are in @layer tc-base now, so a utility on the same element wins
     * outright instead of racing them on stylesheet order.
     */
    expect(css).toContain('@layer tc-base')
  })

  test('the font stacks are not rewritten on the way through', async () => {
    /*
     * This engine replaces a `font-family` written literally in a preflight,
     * in the spaced rule form, when the stack begins `ui-sans-serif` --
     * measured in bughq, where it silently repainted a page. Both stacks here
     * are custom properties whose first entry is a quoted family, and every
     * call site reads them through var(), so neither is a candidate. Asserted
     * because it is a property of the engine, not of this file.
     */
    const css = await generate()
    expect(css).toContain('--sans: \'Geist\', ui-sans-serif, system-ui, -apple-system, sans-serif')
    expect(css).toContain('--mono: \'Geist Mono\', ui-monospace, SFMono-Regular, Menlo, monospace')
    for (const match of TOKENS.matchAll(/(?<!-)font-family\s*:\s*([^;}\n]+)/g))
      expect({ value: match[1].trim(), readsAToken: match[1].includes('var(--') }).toEqual({ value: match[1].trim(), readsAToken: true })
  })
})
