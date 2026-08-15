import type { BunPressOptions } from '@stacksjs/bunpress'

/**
 * The documentation site.
 *
 * This replaced the framework scaffold's config, which described Stacks.js and
 * carried a sidebar for the framework's own documentation. That is a different
 * product: a reader arriving at reportshq.org/docs from the landing page was
 * shown a bootcamp for building Stacks applications.
 *
 * The sidebar below lists every page in `docs/`. Adding a page means adding a
 * line here, and `tests/feature/docs-site.test.ts` fails when the two disagree,
 * so a page cannot exist unreachable and a link cannot point at nothing.
 */
const config: BunPressOptions = {
  verbose: false,
  docsDir: './docs',
  outDir: './dist/docs',

  nav: [
    { text: 'Quickstart', link: '/quickstart' },
    { text: 'Ingestion API', link: '/ingest' },
    { text: 'Pricing', link: 'https://reportshq.org/pricing' },
    { text: 'GitHub', link: 'https://github.com/stacksjs/reportshq' },
  ],

  markdown: {
    title: 'ReportsHQ Documentation',
    meta: {
      description: 'Send the events your application already emits and the reports build themselves.',
      author: 'ReportsHQ',
    },
    syntaxHighlightTheme: 'github-dark',
    toc: {
      enabled: true,
      minDepth: 2,
      maxDepth: 3,
    },
    sidebar: {
      '/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Quickstart', link: '/quickstart' },
            { text: 'Limits', link: '/limits' },
          ],
        },
        {
          text: 'Sending events',
          items: [
            { text: 'Ingestion API', link: '/ingest' },
            { text: 'Event taxonomy', link: '/events' },
            { text: 'Stacks package', link: '/stacks' },
            { text: 'Laravel package', link: '/laravel' },
          ],
        },
        {
          text: 'Reporting',
          items: [
            { text: 'Report builder', link: '/builder' },
            { text: 'Sharing and embeds', link: '/sharing' },
            { text: 'Schedules and exports', link: '/schedules-exports' },
          ],
        },
        {
          text: 'Running it',
          items: [
            { text: 'Self-hosting', link: '/self-hosting' },
            { text: 'API', link: '/api' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Design brief', link: '/design-brief' },
          ],
        },
      ],
    },
  },

  themeConfig: {
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026-present ReportsHQ',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/stacksjs/reportshq' },
    ],
  },

  sitemap: {
    enabled: true,
    baseUrl: 'https://reportshq.org/docs',
  },

  robots: {
    enabled: true,
  },
}

export default config
