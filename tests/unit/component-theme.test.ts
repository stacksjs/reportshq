import { describe, expect, test } from 'bun:test'
import theme from '../../config/crosswind'
// STX exposes its selected CSS engine through these installed files.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { SEMANTIC_TOKENS, SHAPE_TOKENS } from '../../node_modules/@stacksjs/stx/dist/theme-tokens.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

const colors: Record<string, string> = theme.theme.extend.colors

describe('component palette contract', () => {
  test('every component color and radius emits an app-owned utility', async () => {
    const engine = await loadCssEngine()
    if (!engine) throw new Error('The installed STX CSS engine is required')
    const generator = new engine.CSSGenerator(mergeCssConfig(engine.defaultConfig || engine.config, theme).config)
    for (const role of Object.keys(SEMANTIC_TOKENS)) generator.generate(`bg-${role}`)
    for (const role of Object.keys(SHAPE_TOKENS)) generator.generate(`rounded-${role}`)
    const css = generator.toCSS(false, false)
    expect(css).not.toContain('var(--stx-')
    for (const role of Object.keys(SEMANTIC_TOKENS)) expect(css).toContain(`.bg-${role} {`)
    for (const role of Object.keys(SHAPE_TOKENS)) expect(css).toContain(`.rounded-${role} {`)
    expect(css).toContain('.bg-content {\n  background-color: var(--panel);')
    expect(css).toContain('.bg-accent-solid {\n  background-color: var(--accent);')
    expect(css).toContain('.rounded-control {\n  border-radius: 8px;')
    expect(css).toContain('.rounded-panel {\n  border-radius: 0.75rem;')
  })

  test('the quiet text scale stays monotonic, so a separator cannot shout', () => {
    /*
     * The library asks for four steps of quiet text and this palette has three,
     * so two roles share a value. Which two is the whole point.
     *
     * fg-soft used to equal fg-muted. Nothing rendered it -- none of the 53
     * <EmptyState> sites passes an `icon` and there is no <Badge dot> -- so it
     * was invisible, and the contract test above could not see it either: that
     * one asserts every role is MAPPED, not that the mapping means anything.
     * <Breadcrumb> paints separators with fg-soft and its links with fg-muted,
     * so the two being equal is a divider as loud as the labels it divides.
     *
     * Asserted as an ordering rather than as literal values so re-theming the
     * palette cannot quietly reintroduce it.
     */
    const steps = ['fg', 'fg-muted', 'fg-soft', 'fg-subtle'] as const
    const rank: Record<string, number> = { 'var(--text)': 0, 'var(--text-2)': 1, 'var(--text-3)': 2 }
    const ordered = steps.map((role) => {
      const value = colors[role] ?? colors['fg-strong']
      expect(rank[value]).toBeDefined()
      return rank[value]
    })
    for (let i = 1; i < ordered.length; i++)
      expect(ordered[i]).toBeGreaterThanOrEqual(ordered[i - 1])
    expect(colors['fg-soft']).not.toBe(colors['fg-muted'])
  })
})
