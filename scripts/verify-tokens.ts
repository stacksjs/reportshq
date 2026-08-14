/**
 * Proves the design system actually reaches the page.
 *
 * Two things can break silently between public/tokens.css, config/crosswind.ts
 * and a template:
 *
 *   1. A renamed custom property. `var(--gone)` does not error, it falls back
 *      to the property's initial value, so `text-subtle` quietly becomes black.
 *   2. A utility that never survives the serve path. Crosswind's config is
 *      rebuilt by the stx dev server, and not every key written in
 *      config/crosswind.ts is read by it, so a semantic colour can be
 *      configured and still emit no rule at all.
 *
 * Both look like "slightly wrong colours" in a screenshot and like nothing in a
 * diff. This asserts the contract instead: every token the config references is
 * declared in tokens.css for BOTH themes, and every contrast ratio quoted in
 * the token reference is the ratio those hex values actually produce.
 *
 * Run: bun scripts/verify-tokens.ts
 */

const TOKENS = new URL('../public/tokens.css', import.meta.url).pathname
const CROSSWIND = new URL('../config/crosswind.ts', import.meta.url).pathname
const REFERENCE = new URL('../resources/views/design-tokens.stx', import.meta.url).pathname

const failures: string[] = []

function fail(message: string): void {
  failures.push(message)
}

const tokensCss = await Bun.file(TOKENS).text()
const crosswindTs = await Bun.file(CROSSWIND).text()
const referenceStx = await Bun.file(REFERENCE).text()

// --- 1. Every custom property the utilities map onto is declared ------------

const referenced = [...crosswindTs.matchAll(/var\((--[\w-]+)\)/g)].map(match => match[1])
const unique = [...new Set(referenced)]

if (unique.length < 10)
  fail(`only found ${unique.length} tokens referenced in config/crosswind.ts, expected the full palette. Did the file move?`)

/**
 * Tokens that are the same in every theme, and are therefore declared once on
 * `:root` and inherited. The [data-theme] blocks match the same element, so
 * they add to that declaration rather than replacing it; redeclaring a font
 * stack in all four places would just be four copies to drift.
 *
 * Everything NOT listed here is a colour, and a colour that exists in one theme
 * and not another is the bug this check is for.
 */
const themeIndependent = new Set(['--sans', '--mono'])
const themed = unique.filter(token => !themeIndependent.has(token))

for (const token of themeIndependent) {
  if (!blockFor(':root {').includes(`${token}:`))
    fail(`${token} is treated as theme independent but is not declared on :root`)
}

/** The four blocks tokens.css declares: light, dark media, dark attribute, light attribute. */
function blockFor(selector: string): string {
  const start = tokensCss.indexOf(selector)
  if (start < 0)
    return ''
  const open = tokensCss.indexOf('{', start)
  let depth = 0
  for (let i = open; i < tokensCss.length; i++) {
    if (tokensCss[i] === '{')
      depth++
    if (tokensCss[i] === '}') {
      depth--
      if (depth === 0)
        return tokensCss.slice(open, i)
    }
  }
  return ''
}

const themes: Record<string, string> = {
  'light (:root)': blockFor(':root {'),
  'dark (prefers-color-scheme)': blockFor('@media (prefers-color-scheme: dark)'),
  'dark ([data-theme])': blockFor(':root[data-theme=\'dark\']'),
  'light ([data-theme])': blockFor(':root[data-theme=\'light\']'),
}

for (const [theme, block] of Object.entries(themes)) {
  if (!block) {
    fail(`could not find the ${theme} block in public/tokens.css`)
    continue
  }

  for (const token of themed) {
    if (!block.includes(`${token}:`))
      fail(`${token} is used by a utility but never declared in the ${theme} block`)
  }
}

// --- 2. An explicit theme choice must be able to beat the OS preference -----

const attributeDark = tokensCss.indexOf(':root[data-theme=\'dark\']')
const mediaDark = tokensCss.indexOf('@media (prefers-color-scheme: dark)')
if (attributeDark < mediaDark)
  fail('the [data-theme] blocks come before the media query, so an explicit theme choice loses to the OS preference')

for (const [theme, block] of Object.entries(themes)) {
  if (block && !block.includes('color-scheme:'))
    fail(`the ${theme} block does not declare color-scheme, so native controls will not follow it`)
}

// --- 3. Quoted contrast ratios are the ratios these colours produce ---------

function channel(value: number): number {
  const s = value / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  return 0.2126 * channel(Number.parseInt(h.slice(0, 2), 16))
    + 0.7152 * channel(Number.parseInt(h.slice(2, 4), 16))
    + 0.0722 * channel(Number.parseInt(h.slice(4, 6), 16))
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function tokenValue(block: string, token: string): string | undefined {
  return block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
}

const light = themes['light (:root)']
const dark = themes['dark ([data-theme])']

/** [token, surface token, the ratio the reference page prints] */
const claims: Array<[string, string, string, string]> = [
  ['--text', '--bg', '17.49', 'light'],
  ['--text', '--panel', '18.08', 'light'],
  ['--text-2', '--bg', '7.92', 'light'],
  ['--text-2', '--panel', '8.19', 'light'],
  ['--text-3', '--bg', '4.72', 'light'],
  ['--text-3', '--panel', '4.88', 'light'],
  ['--accent', '--bg', '6.33', 'light'],
  ['--accent', '--panel', '6.54', 'light'],
  ['--pos', '--bg', '4.85', 'light'],
  ['--neg', '--bg', '6.08', 'light'],
  ['--warn', '--bg', '4.86', 'light'],
]

for (const [token, surface, claimed, theme] of claims) {
  const block = theme === 'light' ? light : dark
  const a = tokenValue(block, token)
  const b = tokenValue(block, surface)
  if (!a || !b) {
    fail(`cannot read ${token} or ${surface} out of the ${theme} block to check its contrast`)
    continue
  }

  const actual = contrast(a, b)
  if (Math.abs(actual - Number(claimed)) > 0.01)
    fail(`${token} on ${surface} is documented as ${claimed}:1 but measures ${actual.toFixed(2)}:1`)

  if (actual < 4.5)
    fail(`${token} on ${surface} measures ${actual.toFixed(2)}:1, below the 4.5:1 the palette promises`)

  if (!referenceStx.includes(claimed))
    fail(`the token reference page does not show the ${claimed}:1 ratio for ${token}`)
}

// --- 4. Text on a filled accent has to work in BOTH themes -----------------

for (const [label, block] of [['light', light], ['dark', dark]] as const) {
  const ink = tokenValue(block, '--accent-ink')
  const fill = tokenValue(block, '--accent')
  if (!ink || !fill) {
    fail(`cannot read --accent-ink or --accent out of the ${label} block`)
    continue
  }

  const actual = contrast(ink, fill)
  if (actual < 4.5)
    fail(`--accent-ink on --accent measures ${actual.toFixed(2)}:1 in ${label}, below 4.5:1`)
}

// --- 5. No em-dashes anywhere the reader can see them ----------------------

for (const [name, source] of [['tokens.css', tokensCss], ['design-tokens.stx', referenceStx]] as const) {
  if (/[—–]/.test(source))
    fail(`${name} contains an em-dash or en-dash, which the house rules ban in user-visible copy`)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} design token problem${failures.length === 1 ? '' : 's'}:\n`)
  for (const failure of failures)
    console.error(`  - ${failure}`)
  console.error('')
  process.exit(1)
}

console.log(`Design tokens verified: ${unique.length} tokens declared in all four theme blocks, ${claims.length} contrast ratios match their documentation.`)
