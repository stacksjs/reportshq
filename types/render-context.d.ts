/**
 * Names a render context carries into a template or server block, as AMBIENT
 * declarations for `stx typecheck` (passed with --lib in CI; the checker does
 * not read tsconfig's include). Mirrors analyticshq's and loghq's file.
 *
 * Restated rather than imported, because a --lib file with an import stops
 * being ambient and takes every declaration here out of scope.
 */

// --- Partials ---------------------------------------------------------------
//
// An @include shares the including page's scope, so inside a partial these
// arrive as bare names with nothing in the partial to declare them. Every page
// that includes the partial defines them (checked when this file was written:
// all 16 Breadcrumbs pages, every FeatureShot and CompareTable page), so they
// are not optional.

/** partials/Breadcrumbs.stx: the trail; the last crumb is the current page. */
declare const breadcrumbs: { label: string, href?: string }[]
/** partials/Breadcrumbs.stx: the max-width utility matching the page body. */
declare const breadcrumbWidth: string

/** partials/CompareTable.stx: the product ReportsHQ is compared against. */
declare const compareWith: string

/** partials/FeatureShot.stx: the screenshot, its alt text and its caption. */
declare const shot: string
declare const shotAlt: string
declare const shotCaption: string

// --- Route parameters ---------------------------------------------------------

/**
 * reports/[slug].stx: the dynamic segment, passed as a bare name. Absent on a
 * render that did not supply it, so the page guards it with typeof.
 */
declare const slug: string | undefined

// --- stx type gaps ------------------------------------------------------------

/**
 * stx's runtime useSeoMeta accepts and emits `ogSiteName` (dist/head.js, and
 * its own `SeoMeta` type declares it), but the global StxSeoMetaConfig the
 * checker uses omits it, so all 18 marketing pages failed. Interface merging
 * adds the one field. Delete once stx declares it (stacksjs/stx#2209).
 */
interface StxSeoMetaConfig {
  ogSiteName?: string
}
