/**
 * Every public marketing page, in one list.
 *
 * The hub pages, the footer, the breadcrumbs and the sitemap all read this.
 * That is the point: a sitemap maintained by hand is a sitemap that is wrong,
 * and the failure is invisible, because a page missing from it looks perfectly
 * fine to everyone except the crawler that never finds it.
 *
 * Each page's `title` and `description` are also what that page puts in its own
 * `<head>`, so the card that links to a page and the search result for it say
 * the same thing.
 */

export type MarketingGroup = 'features' | 'use-cases' | 'compare'

export interface MarketingPage {
  /** Path segment within the group, so the URL is `/${group}/${slug}`. */
  slug: string
  group: MarketingGroup
  /** The `<title>`, and the heading on the card that links here. */
  title: string
  /** The meta description, and the card's supporting line. */
  description: string
  /** Iconify name for the card. */
  icon: string
}

export interface MarketingHub {
  group: MarketingGroup
  title: string
  heading: string
  description: string
}

export const HUBS: Record<MarketingGroup, MarketingHub> = {
  'features': {
    group: 'features',
    title: 'Features',
    heading: 'What the product actually does',
    description: 'The builder, the reports that create themselves, the integrations, sharing, exports and self-hosting. Each page describes behaviour that exists rather than a roadmap.',
  },
  'use-cases': {
    group: 'use-cases',
    title: 'Use cases',
    heading: 'What people report on',
    description: 'Commerce, SaaS users, content and agency work. Each one starts from the models that kind of application already has, and shows the reports they turn into.',
  },
  'compare': {
    group: 'compare',
    title: 'Comparisons',
    heading: 'How this compares, including when it loses',
    description: 'Every page here names the case where the other tool is the better answer. A comparison that never concedes anything is an advertisement, and readers can tell.',
  },
}

export const PAGES: MarketingPage[] = [
  // Features
  {
    slug: 'builder',
    group: 'features',
    title: 'The report builder',
    description: 'Drag blocks onto a twelve column grid, pick a measure and a dimension, and watch each block redraw. Publish when it is right, so a half finished edit is never what a teammate opens.',
    icon: 'i-hugeicons-dashboard-square-01',
  },
  {
    slug: 'auto-reports',
    group: 'features',
    title: 'Reports that build themselves',
    description: 'Describe a model once, saying which fields are measures and which are dates, and the reports it implies are created with real numbers already in them. Nothing to configure first.',
    icon: 'i-hugeicons-magic-wand-01',
  },
  {
    slug: 'integrations',
    group: 'features',
    title: 'Installing it into your stack',
    description: 'One composer package, a migration, and a config file naming your models. Nothing to deploy beside it, and no tracking calls to write.',
    icon: 'i-hugeicons-cloud-upload',
  },
  {
    slug: 'sharing',
    group: 'features',
    title: 'Sharing and embedding',
    description: 'A link shows one published report and nothing around it. Revoke it and it stops working on the next request. Embed it in a page of your own if you would rather.',
    icon: 'i-hugeicons-link-04',
  },
  {
    slug: 'exports',
    group: 'features',
    title: 'Exports and scheduled delivery',
    description: 'CSV and XLSX in a shape a spreadsheet can pivot, and the headline numbers by email daily, weekly or monthly in your own timezone.',
    icon: 'i-hugeicons-mail-01',
  },
  {
    slug: 'self-hosting',
    group: 'features',
    title: 'Running it yourself',
    description: 'A Stacks application with public source. Run it on your own machines and every tier limit falls away, because there is nothing left to enforce them against.',
    icon: 'i-hugeicons-server-stack-01',
  },

  // Use cases
  {
    slug: 'commerce',
    group: 'use-cases',
    title: 'Commerce reporting',
    description: 'Revenue, orders, average order value and refunds from the Order model your shop already has, covering everything you have ever sold rather than starting at zero today.',
    icon: 'i-hugeicons-shopping-cart-01',
  },
  {
    slug: 'saas-users',
    group: 'use-cases',
    title: 'SaaS user reporting',
    description: 'Signups, activation and the steps between them. Funnels keep whole people when data is sampled, so a conversion rate still means what it says.',
    icon: 'i-hugeicons-user-group',
  },
  {
    slug: 'content',
    group: 'use-cases',
    title: 'Content reporting',
    description: 'Posts, authors and topics from the models your CMS already has, with bounded dimensions that say what went into Other rather than quietly dropping the tail.',
    icon: 'i-hugeicons-book-open-01',
  },
  {
    slug: 'agencies',
    group: 'use-cases',
    title: 'Reporting for agencies',
    description: 'A project per client, a share link per stakeholder, and a scheduled email that arrives before the meeting rather than being assembled during it.',
    icon: 'i-hugeicons-briefcase-01',
  },

  // Comparisons
  {
    slug: 'metabase',
    group: 'compare',
    title: 'ReportsHQ compared with Metabase',
    description: 'Metabase is a service you run beside your application, with its own login and its own connection into production. This is a package inside it, reading the models you already have.',
    icon: 'i-hugeicons-database',
  },
  {
    slug: 'looker-studio',
    group: 'compare',
    title: 'ReportsHQ compared with Looker Studio',
    description: 'Looker Studio draws dashboards over connectors you configure. This owns the collection as well as the drawing, which is fewer moving parts and less reach.',
    icon: 'i-hugeicons-grid',
  },
  {
    slug: 'build-it-yourself',
    group: 'compare',
    title: 'ReportsHQ compared with building it yourself',
    description: 'A table, a cron job and a chart library is a weekend. The second year of it is not. An honest account of what you would end up maintaining.',
    icon: 'i-hugeicons-tools',
  },
]

/**
 * The `<title>` for a page.
 *
 * The site name is appended only when the title does not already carry it, so
 * the comparison pages do not read "ReportsHQ compared with Metabase |
 * ReportsHQ", which is the sort of thing a template produces and nobody reads
 * back.
 */
export function metaTitleFor(title: string): string {
  return title.includes('ReportsHQ') ? title : `${title} | ReportsHQ`
}

/** The pages in one group, in declaration order. */
export function pagesIn(group: MarketingGroup): MarketingPage[] {
  return PAGES.filter(page => page.group === group)
}

/** One page, or null when the slug is unknown. */
export function pageFor(group: MarketingGroup, slug: string): MarketingPage | null {
  return PAGES.find(page => page.group === group && page.slug === slug) ?? null
}

/** The canonical path for a page. */
export function pathFor(page: MarketingPage): string {
  return `/${page.group}/${page.slug}`
}

/**
 * Every public URL, for the sitemap.
 *
 * The standalone pages are listed here rather than in `PAGES` because they have
 * no group and no card; keeping them in the same function is what stops the
 * sitemap from quietly omitting the two most important URLs on the site.
 */
export function publicPaths(): string[] {
  return [
    '/',
    '/pricing',
    '/docs',
    ...Object.keys(HUBS).map(group => `/${group}`),
    ...PAGES.map(pathFor),
  ]
}
