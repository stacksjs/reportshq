import type { CrosswindConfig, Theme } from '@cwcss/crosswind'

/**
 * Crosswind (utility CSS) config.
 *
 * The palette is registered here as semantic colour tokens backed by the CSS
 * custom properties declared in public/tokens.css. That buys real utilities -
 * `bg-panel`, `text-subtle`, `border-line`, `text-accent` - instead of inline
 * `style="color: var(--…)"`, while the variables still swap under
 * `[data-theme]` and `prefers-color-scheme`, so dark mode works without a
 * `dark:` on every single class.
 *
 * WHAT ACTUALLY REACHES THE PAGE
 *
 * The stx serve path does not hand this file to Crosswind wholesale; it
 * rebuilds the generator config in @stacksjs/stx/dist/dev-server/crosswind.js.
 * `theme` is merged there as `{ ...defaultTheme, ...userTheme, extend: … }`,
 * which is why the colours below live under `theme.extend` - that path has
 * survived every version of the serve path, where the others have not been
 * stable. The scaffold's `content`, `minify` and `preflight` keys are gone:
 * class extraction runs over the rendered HTML rather than globs, so a content
 * list means nothing here, and `preflight` was not even a key of
 * CrosswindConfig at the time it was written (the real name is
 * `includePreflight`), so it read as configuration while doing nothing.
 *
 * Proof rather than assumption: `bun scripts/verify-tokens.ts` renders the
 * token reference page through the real serve path and asserts that every
 * utility below appears in the served CSS resolving to the right custom
 * property. Run it after touching either this file or public/tokens.css.
 *
 * @see https://github.com/cwcss/crosswind
 */
export default {
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg)',
        panel: 'var(--panel)',
        line: 'var(--border)',
        ink: 'var(--text)',
        muted: 'var(--text-2)',
        subtle: 'var(--text-3)',
        accent: 'var(--accent)',
        // The accent at low alpha: tinted cells, highlighted rows, the active
        // state of a block in the builder.
        'accent-soft': 'var(--accent-soft)',
        // Ink for text sitting ON a saturated fill. `text-white` is only
        // correct in light mode - dark makes the fills lighter, where white
        // measures 2.35:1 against a 4.5:1 requirement. One class, right in
        // both themes. See public/tokens.css.
        'accent-ink': 'var(--accent-ink)',
        // Deltas and status. Always paired with a direction glyph in the UI,
        // never colour alone.
        pos: 'var(--pos)',
        neg: 'var(--neg)',
        warn: 'var(--warn)',
        // Chart series, so a legend swatch is a class rather than an inline
        // style, and the SVG and the legend can never disagree about what
        // series 3 looks like.
        'series-1': 'var(--series-1)',
        'series-2': 'var(--series-2)',
        'series-3': 'var(--series-3)',
        'series-4': 'var(--series-4)',
        'series-5': 'var(--series-5)',
        'series-6': 'var(--series-6)',
        grid: 'var(--grid)',
        axis: 'var(--axis)',
      },
      // Arrays, not strings: Crosswind joins the entries into the font stack.
      // The whole stack already lives in the custom property, so each is a
      // single entry pointing at it.
      fontFamily: {
        sans: ['var(--sans)'],
        mono: ['var(--mono)'],
      },
    },
  },
// `Partial<CrosswindConfig>` alone is not enough: it makes the top-level keys
// optional, but `theme` still demands every field of Theme (colors, spacing,
// fontSize, screens, borderRadius, boxShadow) when the only path that survives
// the serve merge is `theme.extend`. Narrowing to Pick<Theme, 'extend'> keeps
// the excess-property check that makes this assertion worth having, so a key
// that is not part of CrosswindConfig - like the `preflight` the scaffold
// shipped here - fails the build instead of reading as configuration.
} satisfies Partial<Omit<CrosswindConfig, 'theme'>> & { theme?: Pick<Theme, 'extend'> }
