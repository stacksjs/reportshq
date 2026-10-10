import { describe, expect, test } from 'bun:test'
import theme from '../../config/crosswind'
// STX exposes its selected CSS engine through these installed files.
import { loadCssEngine } from '../../node_modules/@stacksjs/stx/dist/dev-server/ts-css.js'
import { SEMANTIC_TOKENS, SHAPE_TOKENS } from '../../node_modules/@stacksjs/stx/dist/theme-tokens.js'
import { mergeCssConfig } from '../../node_modules/@stacksjs/stx/dist/ts-css-config.js'

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
})
