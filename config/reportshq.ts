import type { ModelDescription } from '@reportshq/stacks'

/**
 * What this application reports on, and the reports it publishes.
 *
 * We run our own package here. That is worth doing for the obvious reason and
 * for a less obvious one: the descriptions below are the first thing a customer
 * writes, so getting them wrong is something we should feel before they do.
 *
 * There is no ingest and no tenant. These read the tables this application
 * already has, in place, which is the whole shape of the product now.
 */

/**
 * The models, and nothing but the models.
 *
 * An allowlist rather than a hint: a column absent from here is unreachable by
 * a query no matter what arrives in a URL. `users` carries a password hash and
 * a set of tokens, and none of them are named below, which is exactly why the
 * page can take a dimension key from a request at all.
 */
export const models: Record<string, ModelDescription> = {
  user: {
    table: 'users',
    measures: {
      accounts: { aggregate: 'count' },
    },
    time: {
      joined: 'created_at',
    },
    dimensions: {
      // Deliberately sparse. An email address is not a dimension worth
      // grouping by, it is a way to accidentally publish a customer list.
      plan: 'plan',
    },
  },
}

/**
 * Reports defined in code rather than in a database.
 *
 * This application's reports do not change from a browser, so storing them in
 * tables would buy an editing surface nobody uses and cost a migration. A
 * report here is reviewed in a pull request and deployed with everything else,
 * which is the property the marketing pages claim and we may as well hold
 * ourselves to.
 */
export const reports = [
  {
    id: 1,
    name: 'Accounts',
    slug: 'accounts',
    description: 'Who has signed up, and when.',
    status: 'published',
    blocks: [
      {
        id: 11,
        kind: 'big_number' as const,
        title: 'Total accounts',
        x: 0,
        y: 0,
        w: 4,
        h: 3,
        query: { model: 'user', measure: 'accounts' },
      },
      {
        id: 12,
        kind: 'line' as const,
        title: 'Signups per day',
        x: 4,
        y: 0,
        w: 8,
        h: 6,
        query: {
          model: 'user',
          measure: 'accounts',
          time: { key: 'joined' },
          grain: 'day' as const,
        },
      },
      {
        id: 13,
        kind: 'note' as const,
        title: 'What this counts',
        x: 0,
        y: 3,
        w: 4,
        h: 3,
        body: 'Every registered account, including ones that never signed in again.',
      },
    ],
  },
]

export default { models, reports }
