import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The chart components, checked against the shapes they are actually given.
 *
 * Every existing test asserts numbers coming out of the compiler and none of
 * them look at what a component draws. That gap let the funnel ship reading
 * `result.steps`, a shape the retired event pipeline produced and nothing
 * produces now, so it always fell through to an empty branch that referenced an
 * `emptyMessage` it never declared. An undefined reference in a compiled render
 * throws, so the element drew nothing at all, on a page that returned 200.
 *
 * These are static checks. They cannot prove a chart looks right, which is what
 * the screenshot pass is for, but they catch a component reading a shape that
 * no longer exists, which is the failure that hides.
 */

const dir = join(import.meta.dir, '..', '..', 'resources', 'components', 'charts')
const components = readdirSync(dir).filter(file => file.endsWith('.stx'))

const source = (file: string) => readFileSync(join(dir, file), 'utf8')

/**
 * The file with its comments removed.
 *
 * These rules are about what the code reads, not what the prose explains. The
 * funnel's own comment names the retired shape it used to read, and without
 * this the comment describing the fix trips the check for the bug.
 */
const code = (file: string) => source(file)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/\{\{--[\s\S]*?--\}\}/g, '')

describe('chart components', () => {
  it('has the components the bundle registers', () => {
    expect(components.length).toBeGreaterThanOrEqual(8)
  })

  it('reads the shape the compiler returns, and no retired one', () => {
    for (const file of components) {
      const body = code(file)

      // `steps`, `buckets`, `rollup` and `events` were all shapes of the hosted
      // pipeline. A component reading one of them is reading something nothing
      // produces.
      for (const retired of ['result.steps', 'result.buckets', 'result.rollup', 'result.events'])
        expect(`${file}: ${body}`).not.toContain(retired)
    }
  })

  it('declares every binding its empty branch renders', () => {
    // The specific way the funnel failed: the template read `emptyMessage` and
    // the script never declared it.
    for (const file of components) {
      const code = source(file)

      if (!code.includes('{{ emptyMessage }}'))
        continue

      expect(`${file}`).toBe(file)
      expect(code.includes('const emptyMessage')).toBe(true)
    }
  })

  it('ships a stylesheet covering the utilities the templates use', () => {
    // The components are dropped into applications that have never heard of
    // Crosswind, and Crosswind extracts from rendered HTML anyway, so these
    // elements render after the pass that would have emitted their classes.
    // A class used and never defined is a silent layout bug: the heatmap cells
    // had no height and drew as a hairline.
    const styles = readFileSync(join(dir, 'charts.css'), 'utf8')

    const used = new Set<string>()
    for (const file of components) {
      for (const attr of code(file).matchAll(/class="([^"]*)"/g)) {
        // An interpolated class is a value, not a name: `class="... {{ tone }}"`
        // resolves to text-pos or text-neg at render time, and neither appears
        // literally in the markup. Drop the interpolation and keep the rest.
        for (const cls of attr[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/)) {
          // Component-owned classes come from the component's own style block.
          if (!cls || cls.startsWith('i-') || cls.startsWith('chart') || cls.startsWith('heat') || cls.startsWith('donut'))
            continue
          used.add(cls)
        }
      }
    }

    // A class is covered if the stylesheet mentions it in any escaped form.
    const missing = [...used].filter((cls) => {
      const escaped = cls.replace(/([.:[\]])/g, '\\$1')

      return !styles.includes(cls) && !styles.includes(escaped)
    })

    expect(missing.sort()).toEqual([])
  })
})
