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
    { text: 'Laravel package', link: '/laravel' },
    { text: 'Pricing', link: 'https://reportshq.org/pricing' },
    { text: 'GitHub', link: 'https://github.com/stacksjs/reportshq' },
  ],

  markdown: {
    title: 'ReportsHQ Documentation',
    meta: {
      description: 'Reports that run inside your own Laravel application, against your own database. Installing the package, describing your models, the query API and the report builder.',
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
            { text: 'Reporting concepts', link: '/concepts' },
            { text: 'Limits', link: '/limits' },
          ],
        },
        {
          text: 'Installing it',
          items: [
            { text: 'Stacks package', link: '/stacks' },
            { text: 'Laravel package', link: '/laravel' },
            { text: 'Configuration', link: '/configuration' },
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
            { text: 'Deploying', link: '/deploy' },
            { text: 'Launch checklist', link: '/launch-checklist' },
            { text: 'Troubleshooting', link: '/troubleshooting' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Query API', link: '/api' },
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
