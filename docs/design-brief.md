# ReportsHQ design brief

The reasoning behind the visual system. Read this before adding a surface, and
before proposing a change to `public/tokens.css`.

## The read

A B2B, developer-facing SaaS for technical buyers who are integrating their own
application. The person deciding is the person who will paste the ingest snippet.
That sets the register: show the product working, do not sell around it.

The visual language is editorial-technical. Restrained layout, confident
typography, and charts carrying the visual interest, because in this product the
charts **are** the interest. A landing page that has to invent decoration is a
landing page whose product has nothing to show.

## Dials

| Dial | Value | Why |
|---|---|---|
| `DESIGN_VARIANCE` | 6 | Enough asymmetry to avoid a templated grid, restrained enough that a report and the page around it do not compete. Data is the variance. |
| `MOTION_INTENSITY` | 4 | Hover feedback, focus, and entry transitions. Nothing continuous. A number that moves on its own is a number nobody trusts. |
| `VISUAL_DENSITY` | 5 | Denser than a marketing site because the app surfaces are dashboards, lighter than a cockpit because most reports are read, not monitored. |

## Colour

**Accent: cobalt `#3a4fd0` (light) / `#8fa2ff` (dark).**

Chosen for what it does not mean. Green, amber and red all carry semantic load in
a reporting product: they are positive, warning and negative. An accent that
shares a hue with a delta makes every number ambiguous, and the ambiguity lands
exactly where the product is supposed to be trustworthy. Blue is the only family
left that reads unmistakably as brand rather than as reading.

It is also deliberately not loghq's rose. The two products are siblings and will
be seen side by side; they should not be mistaken for one another.

**Canvas is warm off-white `#fcfbf9`, panels are true white.** The warmth does
real work. It separates the page from the chart surfaces sitting on it, and it
stops a cool cobalt from reading as default framework blue. loghq pairs a cool
canvas with a warm accent; this is the same idea inverted.

**Deltas are never the accent.** `--pos`, `--neg` and `--warn` are their own
tokens, and every delta in the UI is paired with a direction glyph. Colour alone
fails for the roughly 8% of men with a colour vision deficiency, and a reports
product cannot make its headline numbers unreadable for them.

**Chart series is a six-colour categorical ramp** that starts at the accent, so a
single-series chart is brand coloured for free. It skips the exact positive green
and negative red so a category can never be misread as a direction.

Every ratio is measured, not estimated. `bun scripts/verify-tokens.ts` recomputes
them from the hex values and fails if the documentation drifts. Nothing ships
below 4.5:1.

## Type

**Geist for text, Geist Mono for every figure.**

The mono is not decoration. Every number in a report, table cell, axis tick and
delta is set in it with tabular numerals, so a column of figures aligns on the
digit instead of drifting with proportional widths. Use the `.num` class for
figures inside prose that are not already in a mono context.

Geist rather than loghq's Space Grotesk: it has the tabular figures this product
depends on, it is developer-native without being Inter, and the two products stay
distinguishable.

## Architecture

Tokens live in `public/tokens.css`, linked once from `config/ui.ts`. They are
**not** in the Crosswind `preflights` key, which reads like the obvious home for
them and is never emitted on the stx serve path.

`config/crosswind.ts` maps semantic utilities onto those custom properties, which
is what buys `bg-panel` and `text-subtle` instead of inline `style="color:
var(--…)"`. Because the properties swap under `[data-theme]` and
`prefers-color-scheme`, dark mode needs no `dark:` variant on individual classes.

Theme is set once, at the root, by the pre-paint boot script stx emits from
`config/ui.ts` `app.colorMode`. Do not add a second theme guard; two of them
fight, and light loses on refresh.

## Rules this system carries

1. **One accent, everywhere.** No section gets its own colour.
2. **One theme per page.** Sections do not invert mid-scroll.
3. **One radius scale.** 8px for controls, 12px for panels, full for pills.
4. **No em-dashes** in anything a reader sees.
5. **No hand-drawn vectors** except the wordmark. Icons are Iconify
   `i-hugeicons-*`; charts are drawn by the chart components from real data.
6. **Reduced motion is honoured globally** in `tokens.css`, so a new animation
   cannot forget it.

## Verifying

```bash
bun scripts/verify-tokens.ts
```

Checks that every token a utility maps onto is declared in all four theme blocks,
that an explicit theme choice still beats the OS preference, that every quoted
contrast ratio is the ratio those colours actually produce, and that text on a
filled accent clears AA in both themes.

The rendered proof is `/design-tokens`, which shows every colour through the
utility that resolves it.
