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
/*
 * Page CSS that cannot be a utility, kept in the typed config rather than a
 * <style> block in the view (stx-standards rule 3).
 *
 * The chart components under resources/components/charts are deliberately NOT
 * here. Their <style> blocks are build inputs: `buddy build --web-components`
 * compiles each one into an @scope (stacks-bar-chart){...} rule inside
 * public/reportshq-charts.css, which then ships to packages/laravel and
 * packages/stacks. A consumer there loads that stylesheet and the bundle and
 * has no crosswind at all, so a utility class would style nothing, and the
 * @scope encapsulation would be lost on the way. tests/unit/page-style-leak.ts
 * has said so since before this file did.
 */
const PAGE_CSS = `
/*
 * views/index.stx. A custom element is inline with no intrinsic size, so a
 * chart that sizes itself to its container collapses to nothing and renders
 * its axis labels into a zero-height box. The package's own stylesheet does
 * this for the report grid; the marketing page lays them out itself and has to
 * say so too.
 *
 * Element selectors on custom elements, so there is no class to hang a utility
 * on. Nothing in that page sets display or min-height on them.
 */
stacks-big-number, stacks-bar-chart, stacks-line-chart,
stacks-donut-chart, stacks-table-chart, stacks-funnel-chart { display: block; }
stacks-bar-chart, stacks-line-chart, stacks-donut-chart { min-height: 13rem; }
stacks-big-number { min-height: 4.5rem; }
/*
 * The chart draws into a viewBox and leaves sizing to its container. An SVG
 * with no width resolves to zero, so the paths are correct and invisible,
 * which looks like a data problem and is not one.
 */
stacks-bar-chart svg, stacks-line-chart svg, stacks-donut-chart svg,
stacks-funnel-chart svg { width: 100%; height: 100%; display: block; }

/*
 * views/pricing.stx. The billing toggle, in CSS alone.
 *
 * The checkbox is the state. Yearly prices are hidden until it is checked, and
 * monthly prices hide in its place. Nothing here needs to run, so the toggle
 * works on the first paint rather than after a bundle arrives. The input keeps
 * its native focus behaviour and is only visually hidden, so it stays
 * reachable from the keyboard and still announced as a checkbox with its label.
 *
 * None of this is expressible as a utility: every rule is driven by a sibling
 * checkbox's :checked state, on elements the checkbox does not contain.
 *
 * Three declarations carry !important, and they are the ones whose element also
 * carries a utility for the same property -- the track has \`bg-panel\` and
 * \`border-line\`, the knob has \`bg-subtle\`. Those are unlayered and this is
 * @layer cw-base, and an unlayered rule beats a layered one at any specificity,
 * so without the mark the toggle would flip and nothing would change colour.
 * \`background-color\` rather than the \`background\` shorthand, so the override
 * is exactly as wide as the utility it has to beat.
 */
.price-yearly { display: none; }
.billing-input:checked ~ .tiers .price-monthly { display: none; }
.billing-input:checked ~ .tiers .price-yearly { display: block; }
.billing-input:checked ~ label .billing-track {
  background-color: var(--accent) !important;
  border-color: var(--accent) !important;
}
.billing-input:checked ~ label .billing-knob {
  background-color: var(--accent-ink) !important;
  transform: translateX(1rem);
}
/*
 * The focus ring belongs on the visible control, since the input itself is
 * off-screen and a keyboard user would otherwise see nothing move. No utility
 * on the track sets an outline, so this needs no mark.
 */
.billing-input:focus-visible ~ label .billing-track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
`

export default {
  preflights: [{ getCSS: () => PAGE_CSS }],
  shortcuts: {
    // Account action panels keep the page surface and existing 20px inset.
    // Do not clip keyboard focus rings on links or buttons inside a Card.
    'report-action-panel': '!p-5 !bg-transparent !overflow-visible',
  },
  theme: {
    extend: {
      borderRadius: {
        control: '8px',
        panel: '0.75rem',
        pill: '999px',
      },
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
        // The folded tail. Neutral on purpose: "Other" is not an identity, and
        // giving it a hue makes it compete with the categories it is hiding.
        'series-other': 'var(--series-other)',
        grid: 'var(--grid)',
        axis: 'var(--axis)',

        // Complete component roles follow the same palette as the reports.
        // Keep content as a surface and ink paired with its solid/soft fill.
        // Theme entries override library defaults without cascade-layer tricks.
        'surface': 'var(--panel)',
        'surface-sunken': 'var(--bg)',
        'surface-raised': 'color-mix(in srgb, var(--accent) 8%, var(--panel))',
        'surface-hover': 'color-mix(in srgb, var(--text) 6%, var(--panel))',
        'surface-raised-hover': 'color-mix(in srgb, var(--accent) 14%, var(--panel))',
        'surface-sunken-hover': 'color-mix(in srgb, var(--text) 6%, var(--bg))',
        'page': 'var(--bg)',
        'content': 'var(--panel)',
        'field': 'var(--panel)',
        'field-hover': 'color-mix(in srgb, var(--text) 6%, var(--panel))',
        'fg': 'var(--text)',
        'fg-strong': 'var(--text)',
        'fg-muted': 'var(--text-2)',
        /*
         * The library's quiet text scale is four steps - fg, fg-muted, fg-soft,
         * fg-subtle - and this palette has three, so two roles share a value.
         * They used to share at the WRONG end: fg-soft was byte-identical to
         * fg-muted, which makes "quieter than muted" exactly as loud as muted.
         *
         * Nothing renders it today, which is why it was invisible: of the 53
         * <EmptyState> sites in the estate none passes an `icon` (the only
         * thing there that reads fg-soft) and there is no <Badge dot>. But
         * <Breadcrumb> paints separators with fg-soft and links with fg-muted,
         * so the two being equal is a divider as loud as the labels it divides.
         *
         * Doubling up at the quiet end keeps the scale monotonic, so a
         * component asking for a quieter grey gets one.
         */
        'fg-soft': 'var(--text-3)',
        'fg-subtle': 'var(--text-3)',
        'line-strong': 'color-mix(in srgb, var(--text-3) 55%, var(--border))',
        'line-hover': 'color-mix(in srgb, var(--text-2) 70%, var(--border))',
        'link': 'var(--accent)',
        'link-hover': 'color-mix(in srgb, var(--accent) 85%, var(--text))',
        'accent-solid': 'var(--accent)',
        'accent-solid-hover': 'color-mix(in srgb, var(--accent) 92%, var(--text))',
        'accent-soft-ink': 'color-mix(in srgb, var(--accent) 85%, var(--text))',
        'success': 'var(--pos)',
        'success-solid': 'var(--pos)',
        'success-solid-hover': 'color-mix(in srgb, var(--pos) 92%, var(--text))',
        'success-ink': 'var(--accent-ink)',
        'success-soft': 'color-mix(in srgb, var(--pos) 8%, var(--panel))',
        'success-soft-ink': 'color-mix(in srgb, var(--pos) 85%, var(--text))',
        'danger': 'var(--neg)',
        'danger-solid': 'var(--neg)',
        'danger-solid-hover': 'color-mix(in srgb, var(--neg) 92%, var(--text))',
        'danger-ink': 'var(--accent-ink)',
        'danger-soft': 'color-mix(in srgb, var(--neg) 8%, var(--panel))',
        'danger-soft-ink': 'color-mix(in srgb, var(--neg) 85%, var(--text))',
        'warning': 'var(--warn)',
        'warning-solid': 'var(--warn)',
        'warning-solid-hover': 'color-mix(in srgb, var(--warn) 92%, var(--text))',
        'warning-ink': 'var(--accent-ink)',
        'warning-soft': 'color-mix(in srgb, var(--warn) 8%, var(--panel))',
        'warning-soft-ink': 'color-mix(in srgb, var(--warn) 85%, var(--text))',
        'info': 'var(--text-2)',
        'info-solid': 'var(--text-2)',
        'info-solid-hover': 'color-mix(in srgb, var(--text-2) 92%, var(--text))',
        'info-ink': 'var(--accent-ink)',
        'info-soft': 'color-mix(in srgb, var(--text-2) 8%, var(--panel))',
        'info-soft-ink': 'color-mix(in srgb, var(--text-2) 85%, var(--text))',
        'secondary': 'var(--text-2)',
        'secondary-solid': 'var(--text-2)',
        'secondary-solid-hover': 'color-mix(in srgb, var(--text-2) 92%, var(--text))',
        'secondary-ink': 'var(--accent-ink)',
        'secondary-soft': 'color-mix(in srgb, var(--text-2) 8%, var(--panel))',
        'secondary-soft-ink': 'color-mix(in srgb, var(--text-2) 85%, var(--text))',
        'danger-fg': 'var(--neg)',
        'danger-fg-subtle': 'var(--neg)',
        'danger-line': 'var(--neg)',
        'danger-focus': 'var(--neg)',
        'inverse': 'var(--text)',
        'inverse-ink': 'var(--bg)',
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
