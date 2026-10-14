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
 *
 * index.stx and pricing.stx no longer have a block to place: both moved into
 * config/crosswind.ts PAGE_CSS under stx-standards rule 3, which is a stronger
 * version of what this file enforces -- CSS in the one <style data-crosswind>
 * tag the router preserves cannot be outside the container or left behind. The
 * second test below is what pricing.stx's move makes unfalsifiable rather than
 * merely passing.
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

  test('only the documented exemptions still carry a style block', () => {
    /*
     * stx-standards rule 3, as an allowlist. Both entries are exemptions with a
     * reason, not debt:
     *
     *   charts/*.stx    compiled by `buddy build --web-components` into
     *                   @scope (stacks-bar-chart){...} rules in
     *                   public/reportshq-charts.css, which ships to
     *                   packages/laravel and packages/stacks. A consumer there
     *                   has no crosswind, so a utility class would style
     *                   nothing -- and the @scope encapsulation would be lost.
     *   coming-soon.stx a complete standalone document, own <!DOCTYPE>, own
     *                   <head>, own fonts and its own :root palette (--brand,
     *                   not the app's --accent). Its `*` reset and `body` rules
     *                   would repaint every other page from a shared preflight.
     *
     * Shrink it only with a reason that survives reading those two.
     */
    const all: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory())
          walk(full)
        else if (entry.endsWith('.stx') && /^[ \t]*<style[ >]/m.test(blank(readFileSync(full, 'utf8'))))
          all.push(full.slice(ROOT.length + 1))
      }
    }
    walk(join(ROOT, 'resources'))
    expect(all.sort()).toEqual([
      'resources/components/charts/BarChart.stx',
      'resources/components/charts/DonutChart.stx',
      'resources/components/charts/HeatmapChart.stx',
      'resources/components/charts/LineChart.stx',
      'resources/views/coming-soon.stx',
    ])
  })
})
