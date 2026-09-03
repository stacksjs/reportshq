import type { LibraryConfig } from '@stacksjs/types'

/**
 * **Library Configuration**
 *
 * This configuration defines all of your library options. Because Stacks is fully-typed, you
 * may hover any of the options below and the definitions will be provided. In case you
 * have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  name: 'reportshq',
  owner: 'stacksjs',
  repository: 'stacksjs/reportshq',
  license: 'MIT',
  author: 'Chris Breuer',
  contributors: ['Chris Breuer <chris@stacksjs.com>'],
  defaultLanguage: 'en',
  releaseable: true,

  // The chart elements, bundled by `buddy build --web-components` into the
  // file that build:charts copies to public/reportshq/charts.js and into both
  // integration packages. Every .stx under resources/components is included,
  // which is the default and the set that has always been bundled.
  //
  // `include` is set explicitly rather than left to default. The resolver's
  // precedence is include > files > tags > default, and this app's config is
  // merged over the framework's, whose own `tags` name a HelloWorld element
  // that does not exist here. Omitting all three would inherit that tag and
  // build a package matching no files, which 0.74 turned from a silent
  // fallback into a hard error. Naming the glob keeps every .stx in the
  // bundle, which is the set that has always shipped.
  webComponents: {
    name: '@reportshq/elements',
    description: 'The ReportsHQ chart elements: line, bar, donut, funnel, heatmap, table, big number and text.',
    keywords: ['reports', 'charts', 'custom-elements', 'web-components', 'stx', 'typescript'],
    include: ['**/*.stx'],
    // The element names are public API. They are `stacks-line-chart` and
    // friends in this app's views, in packages/stacks and in packages/laravel,
    // and in every install of those out in the world. 0.74 derives the prefix
    // from the package name, so renaming the package away from the scaffold
    // would have quietly re-registered all nine as `elements-*` and left every
    // chart blank. Pinned, so the name and the prefix can move independently.
    prefix: 'stacks',
  },

  functions: {
    name: '@reportshq/functions',
    description: 'Client helpers the chart elements use.',
    keywords: ['reports', 'charts', 'functions', 'composables', 'typescript'],
    shouldGenerateSourcemap: false,
    files: ['charts', 'counter', 'dark'],
  },
} satisfies LibraryConfig
