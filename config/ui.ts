import type { StxOptions as UiOptions } from '@stacksjs/stx'

/**
 * STX Configuration for Stacks
 * Note: Dashboard mode overrides these settings via serve() options
 */

export default {
  // Pin template topology to the application resources directory. This keeps
  // component, layout and partial resolution stable for CLI, dev and build
  // processes instead of asking each process to infer the same root.
  root: 'resources',

  // Where stx keeps everything it generates: the compiled-template cache, the
  // Crosswind CSS cache, client-script bundles, the route manifest and route
  // types. Stacks keeps every runtime-owned directory under storage/ rather
  // than a `.stx` in the project root - see `stxPath()` in @stacksjs/path,
  // which also exports this as STX_DIR for processes that never read a config.
  stateDir: 'storage/framework/stx',

  // Components, layouts and partials directories.
  //
  // These are resolved RELATIVE TO the explicit `resources` stx root.
  // Spelling them `resources/components` here made stx join the
  // root on a second time and look in `resources/resources/components`, so
  // `<Card />` in a template resolved to nothing and stx warned on every boot.
  componentsDir: 'components',

  // Expose @stacksjs/components' ui library (<Sidebar>, <Button>, ...)
  // to tag resolution everywhere — the dashboard's macOS-style sidebar
  // resolves through this. See the plugin file for the lookup order.
  plugins: ['./storage/framework/defaults/stx-components-plugin.ts'],

  layoutsDir: 'layouts',

  partialsDir: 'partials',

  // Whether this app serves the framework's default views, which include a
  // demo storefront (/cart, /checkout/*, /orders/:id) alongside the error
  // pages and mail previews. `true` serves all of them and is the historical
  // behaviour; `false` serves only `resources/views`; an array names the
  // subtrees to keep, e.g. `['errors', 'emails']`. Applies to `buddy dev` and
  // `buddy serve` alike, and to whatever the route manifest enumerates into
  // the sitemap.
  defaultViews: true,

  app: {
    // --- Theme ---------------------------------------------------------------
    // The single declaration of how this app themes. Any useColorMode call in
    // the app MUST match these values: stx emits its pre-paint boot script from
    // this same option surface, and if the two disagree the boot script sets
    // one thing and hydration immediately undoes it, which is a worse flash
    // than having no boot script at all.
    //
    // Declaring it also stands down stx's legacy theme guard, which reads a
    // `theme` localStorage key nothing here writes and therefore falls through
    // to its own default - stamping the wrong theme on <html> before first
    // paint for anyone whose preference disagrees with it.
    colorMode: {
      storageKey: 'reportshq_theme',
      attribute: 'data-theme',
      darkClass: 'dark',
      initialMode: 'auto',
    },

    head: {
      title: 'ReportsHQ',
      lang: 'en',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Send events, get reports that build themselves.' },
        // Both themes are declared so the browser paints its own chrome (form
        // controls, scrollbars) correctly before tokens.css arrives.
        { name: 'color-scheme', content: 'light dark' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        // Geist for text, Geist Mono for every figure. display=swap so a slow
        // font never blocks the first paint of a report.
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap' },
        // Design tokens, once, for every route. Everything else that styles
        // this app resolves its colours from here.
        { rel: 'stylesheet', href: '/tokens.css' },
      ],
    },
  },
// `plugins` landed in stx after the pinned @stacksjs/stx types — widen until the dep updates.
} satisfies UiOptions & { plugins?: string[], defaultViews?: boolean | string[] }
