import type { CrosswindConfig, Theme } from '@cwcss/crosswind'

/**
 * Crosswind (utility CSS) config.
 *
 * The palette is registered here as semantic colour tokens backed by the CSS
 * custom properties declared in TOKENS below. That buys real utilities -
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
 * property. Run it after touching this file.
 *
 * @see https://github.com/cwcss/crosswind
 */
/*
 * The design tokens. Declared here and nowhere else (stx-standards rule 3,
 * §11.2).
 *
 * They lived in public/tokens.css until 2026-10-15, linked from config/ui.ts,
 * because that file said `preflights` is "spread into the generator config and
 * then never emitted, so a token placed there reaches no page at all", and
 * named loghq as where it had been verified. loghq's own config had already
 * been corrected and carries the measurement: stacksjs/stx #1867 unified the
 * two render paths onto one merge, and the behaviour the note described was
 * real only before it.
 *
 * Re-measured on THIS app's installed stx 0.2.532 rather than inherited a
 * second time: mergeCssConfig() reports includePreflight true, carries the
 * entries into `config`, and a probe token placed in `preflights` comes back
 * out of toCSS(). PAGE_CSS below had been reaching the page that whole time,
 * which is the same proof from the other direction.
 *
 * What the move changes, and does not:
 *
 *   - The sheet is linked where the generated sheet is linked, which is after
 *     where /tokens.css was. Nothing else declares these names -- the four
 *     `--rhq-*` aliases in public/reportshq-charts.css read them through
 *     var() and resolve at use time, not at declaration order -- so no
 *     resolution changes.
 *   - A preflight lands in @layer tc-base, so the chrome rules at the bottom
 *     (`body`, `.num`) now LOSE to a utility on the same element instead of
 *     racing it on source order. That is the direction a page wants.
 *   - The `*` reduced-motion block keeps its marks. For important
 *     declarations the layer order reverses, so a layered !important beats an
 *     unlayered one; it got stronger, not weaker.
 *
 * public/reportshq-charts.css stays where it is and is not debt: it is build
 * output, concatenated by `bun run build:charts` from the chart components'
 * own <style> blocks plus resources/components/charts/{charts,grid}.css, and
 * it ships to consumers who have no crosswind at all.
 *
 * `bun scripts/verify-tokens.ts` reads the block below directly and asserts
 * every utility in this file resolves to a property declared in all four
 * theme blocks. Run it after touching either half.
 */
const TOKENS = `
:root {
  /* The one declaration that reaches the parts of the page we do not draw.
   * Native UI - select popups, scrollbars, date pickers, form control
   * backgrounds, the caret - is painted by the browser from \`color-scheme\`,
   * not from custom properties. It is declared on all four blocks below and
   * never once on :root as \`light dark\`, because that means "either is fine,
   * follow the OS", which is wrong the moment someone picks a theme. */
  color-scheme: light;

  /* Canvas is a warm off-white, panels are true white. The warmth is doing
   * real work: it separates the page from the chart surfaces sitting on it,
   * and it keeps a cool cobalt accent from reading as default framework blue.
   * loghq's canvas is cool (#fbfbfd) with a rose accent; this is the opposite
   * pairing on purpose, so the two products are not mistaken for each other. */
  --bg: #fcfbf9;
  --panel: #ffffff;
  --border: rgba(20, 22, 28, 0.10);

  /* 17.49:1 on --bg, 18.08:1 on --panel. */
  --text: #14161c;
  /* 7.92:1 on --bg, 8.19:1 on --panel. Body copy and secondary labels. */
  --text-2: #4a4f5c;
  /* 4.72:1 on --bg, 4.88:1 on --panel. The smallest step that still clears AA
   * on the worse of the two surfaces, so "subtle" reads subtle without
   * failing. Anything lighter is decoration pretending to be text. */
  --text-3: #6b7180;

  /* Cobalt. Chosen for what it does NOT mean: green, amber and red all carry
   * semantic load in a reporting product (positive, warning, negative), and an
   * accent that collides with a delta colour makes every number ambiguous.
   * Blue is the only family left that is unmistakably "brand" rather than
   * "reading". 6.33:1 on --bg, 6.54:1 on --panel, so it is legible as link
   * text and not only as a fill. */
  --accent: #3a4fd0;
  --accent-soft: rgba(58, 79, 208, 0.08);
  /* Ink for text sitting ON a saturated fill. It cannot be a hardcoded #fff:
   * in dark mode the fills get lighter, not darker, and white on the dark
   * accent measures 2.35:1. White on this light accent is 6.54:1; the dark
   * counterpart below is 8.34:1 on its own fill. One class, right in both. */
  --accent-ink: #ffffff;

  /* Deltas and status. \`--pos\` and \`--neg\` are deliberately NOT the accent:
   * a number that moved is data, a button is chrome, and they must not share a
   * colour. Both are also always paired with a direction glyph in the UI,
   * because red/green alone fails for the ~8% of men with a colour vision
   * deficiency, and a reports product cannot make its headline numbers
   * unreadable for them.
   * pos 4.85:1 on --bg, neg 6.08:1, warn 4.86:1. */
  --pos: #15803d;
  --neg: #be123c;
  --warn: #b45309;

  /* Geist for text, Geist Mono for anything numeric. The mono is not
   * decoration: every figure in a report, a table cell, an axis tick and a
   * delta is set in it, so columns of numbers align on the digit rather than
   * drifting with proportional widths. */
  --sans: 'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Chart series: five categorical colours plus a neutral for the folded tail.
   *
   * Computed, not chosen. Every candidate was run through the dataviz skill's
   * validator, which checks the OKLCH lightness band, a chroma floor, adjacent
   * colour-vision-deficiency separation, a normal-vision floor and contrast
   * against this exact surface. Two earlier picks failed it: a pair of teals
   * measured 0.094 and 0.086 chroma, under the 0.1 floor, meaning they read as
   * grey to everyone.
   *
   * FIVE rather than six, deliberately. Six hues cannot clear the separation
   * floors inside dark mode's narrow lightness band without wrapping the hue
   * wheel and repeating a family, and the standard's own remedy for that is to
   * cut series rather than generate another hue. The sixth slot is neutral and
   * carries the "Other" bucket, which is what a folded tail should look like.
   *
   * The same five hues serve both themes, at different lightness, so a series
   * never changes hue family when someone switches theme.
   *
   * One adjacent pair (green against gold) sits in the 6 to 8 CVD band, which
   * is permitted ONLY with secondary encoding. That is why every chart with two
   * or more series ships a legend, why up to four series are also labelled
   * directly, and why adjacent fills carry a 2px surface gap. Those are not
   * decoration; they are what makes this palette legal. */
  --series-1: #6860f2;
  --series-2: #ae1f61;
  --series-3: #9d7120;
  --series-4: #1c754a;
  --series-5: #2383b4;
  --series-other: #6b7180;
  /* Grid lines and axis rules sit under the data and must never compete with
   * it. Both are alpha values so they hold up over a tinted panel. */
  --grid: rgba(20, 22, 28, 0.08);
  --axis: rgba(20, 22, 28, 0.28);
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #0b0d12;
    --panel: #12151d;
    --border: rgba(148, 163, 184, 0.12);
    /* 17.65:1 on --bg, 16.57:1 on --panel. */
    --text: #f2f4f8;
    /* 9.74:1 on --bg, 9.15:1 on --panel. */
    --text-2: #b0b8c7;
    /* 5.36:1 on --bg, 5.03:1 on --panel. */
    --text-3: #7d8798;
    /* 8.13:1 on --bg, 7.63:1 on --panel. */
    --accent: #8fa2ff;
    --accent-soft: rgba(143, 162, 255, 0.12);
    /* 8.34:1 on the dark accent fill. */
    --accent-ink: #060814;
    --pos: #4ade80;
    --neg: #fb7185;
    --warn: #fbbf24;
    --series-1: #6963ec;
    --series-2: #e33783;
    --series-3: #9c7228;
    --series-4: #349c67;
    --series-5: #2d83b0;
    --series-other: #7d8798;
    --grid: rgba(148, 163, 184, 0.10);
    --axis: rgba(148, 163, 184, 0.34);
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0b0d12;
  --panel: #12151d;
  --border: rgba(148, 163, 184, 0.12);
  --text: #f2f4f8;
  --text-2: #b0b8c7;
  --text-3: #7d8798;
  --accent: #8fa2ff;
  --accent-soft: rgba(143, 162, 255, 0.12);
  --accent-ink: #060814;
  --pos: #4ade80;
  --neg: #fb7185;
  --warn: #fbbf24;
  --series-1: #6963ec;
  --series-2: #e33783;
  --series-3: #9c7228;
  --series-4: #349c67;
  --series-5: #2d83b0;
  --series-other: #7d8798;
  --grid: rgba(148, 163, 184, 0.10);
  --axis: rgba(148, 163, 184, 0.34);
}

:root[data-theme='light'] {
  color-scheme: light;
  --bg: #fcfbf9;
  --panel: #ffffff;
  --border: rgba(20, 22, 28, 0.10);
  --text: #14161c;
  --text-2: #4a4f5c;
  --text-3: #6b7180;
  --accent: #3a4fd0;
  --accent-soft: rgba(58, 79, 208, 0.08);
  --accent-ink: #ffffff;
  --pos: #15803d;
  --neg: #be123c;
  --warn: #b45309;
  --series-1: #6860f2;
  --series-2: #ae1f61;
  --series-3: #9d7120;
  --series-4: #1c754a;
  --series-5: #2383b4;
  --series-other: #6b7180;
  --grid: rgba(20, 22, 28, 0.08);
  --axis: rgba(20, 22, 28, 0.28);
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
}

/* Numbers are monospaced and tabular everywhere they carry meaning. \`tnum\`
 * forces equal-width digits even in the sans, which matters for the inline
 * figures inside prose that are not wrapped in a .num. */
.num {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}

/* Theme-toggle icon swap. No utility can express this: the selector is an
 * attribute-state descendant on the root, and the root attribute is what the
 * pre-paint boot script sets before first paint. Keying off the button's own
 * state instead would leave both icons hidden until hydration, which is an
 * empty box on every cold load. */
.theme-btn .ic-sun,
.theme-btn .ic-moon {
  display: none;
}

:root[data-theme='light'] .theme-btn .ic-sun {
  display: block;
}

:root[data-theme='dark'] .theme-btn .ic-moon {
  display: block;
}

/* Skeleton pulse for loading states. Utilities cannot declare @keyframes, so
 * this is a preflight rather than a utility.
 *
 * Named rhq-pulse rather than pulse deliberately: Crosswind emits its own
 * @keyframes pulse as soon as any page uses \`animate-pulse\`, into a sheet
 * linked after this file, and a same-named keyframe there would silently
 * replace this one rather than error. */
@keyframes rhq-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.9;
  }
}

/* Charts and skeletons are the only things on the page that animate on load,
 * and neither may move for someone who asked the OS for stillness. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`

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
  preflights: [{ getCSS: () => TOKENS }, { getCSS: () => PAGE_CSS }],
  shortcuts: {
    // Account action panels keep the page surface and existing 20px inset.
    // Do not clip keyboard focus rings on links or buttons inside a Card.
    'report-action-panel': '!p-5 !bg-transparent !overflow-visible',

    /*
     * Off-screen but still announced: a label that belongs to a field whose
     * placeholder carries the visible text.
     *
     * coming-soon.stx already named this class and then wrote the whole rule
     * inline beside it, which meant the class did nothing -- it was defined
     * NOWHERE, here or in any page. Deleting the inline style on the strength of
     * the class name would have put the label on screen. Defining it is what
     * makes the name true.
     *
     * The declarations reproduce that inline rule exactly, `clip` included.
     * `clip` is deprecated in favour of `clip-path: inset(50%)`, but swapping it
     * changes which browsers hide the label, and that is a separate decision
     * from moving the rule out of the markup.
     */
    'visually-hidden': 'absolute w-px h-px overflow-hidden [clip:rect(0_0_0_0)]',
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
