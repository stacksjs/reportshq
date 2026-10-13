/**
 * A page's own CSS must sit inside that page's <main>.
 *
 * <main> is the router's container. A <style> inside it travels with the page;
 * one outside it does not, and here that broke in BOTH directions rather than
 * just leaking.
 *
 * Measured on the served pages 2026-10-13, with pricing.stx's block sitting
 * after </template>:
 *
 *   - Arriving at /pricing from a link, the block never came. `.price-yearly`
 *     elements rendered with no rule behind them and computed `display: block`,
 *     so the monthly AND yearly prices showed at once and the billing toggle
 *     did nothing. The page was only correct on a full document load.
 *   - Arriving at /pricing by a full load and then clicking away, the block
 *     never left. `.price-yearly { display: none }` stayed live on every page
 *     visited afterwards.
 *
 * Both are the same cause and the same fix. After the move: hopping
 * /features/builder -> /pricing brings the rule (the element computes `display:
 * none`), and hopping back takes it away again.
 *
 * Not checked here:
 *   - layouts/, partials/ -- their blocks belong to every page they serve.
 *   - components/charts/*.stx -- those <style> blocks are BUILD inputs,
 *     concatenated into public/reportshq-charts.css by `bun run build:charts`
 *     and linked as a stylesheet. They are not page CSS.
 *   - coming-soon.stx -- a standalone maintenance document with its own
 *     <!DOCTYPE> and <head>, served outside the router entirely.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../..')
const VIEWS = join(ROOT, 'resources/views')
const EXEMPT = ['coming-soon.stx']

function views(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'layouts' && entry !== 'partials')
        out.push(...views(full))
    }
    else if (entry.endsWith('.stx')) {
      out.push(full)
    }
  }
  return out
}

/** Blank comments so prose about <main> is not read as markup. */
const blank = (src: string): string => src.replace(/\{\{--[\s\S]*?--\}\}/g, m => ' '.repeat(m.length))

describe('page style leak', () => {
  const files = views(VIEWS)
    .map(f => [f.slice(VIEWS.length + 1), readFileSync(f, 'utf8')] as const)
    .filter(([name]) => !EXEMPT.includes(name))

  test('every view keeps its <style> inside <main>', () => {
    for (const [name, src] of files) {
      const s = blank(src)
      if (!/<style/.test(s))
        continue
      const open = s.search(/<main\b/)
      const close = s.lastIndexOf('</main>')
      expect(`${name}: has <main>`).toBe(`${name}: ${open >= 0 && close > open ? 'has <main>' : 'MISSING'}`)
      for (const m of s.matchAll(/<style/g))
        expect(`${name}@${m.index}: ${m.index! > open && m.index! < close}`).toBe(`${name}@${m.index}: true`)
    }
  })

  test('no view puts a <style> after </template>', () => {
    // The specific shape pricing.stx had. An SFC style block reads as the
    // natural place to put a page's CSS and is the one place it cannot go:
    // it lands outside the container on both the way in and the way out.
    for (const [name, src] of files) {
      const s = blank(src)
      const end = s.lastIndexOf('</template>')
      if (end < 0)
        continue
      expect(`${name}: ${/<style/.test(s.slice(end))}`).toBe(`${name}: false`)
    }
  })
})
