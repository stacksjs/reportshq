/**
 * A filter applied to a whole report, from the URL.
 *
 * The point is that a view is linkable. Somebody narrowing a report to one plan
 * and pasting the URL into a conversation is sharing what they are looking at,
 * not a page that will resolve differently for the reader. So the filter lives
 * in the query string and nowhere else: no cookie, no session, no server state.
 *
 * **Bounded to the same allowlist a block config uses.** These values arrive
 * from a URL, which anybody can edit, and they end up in a query. Reusing
 * `isAllowedField` rather than writing a second check here is what stops the
 * two drifting apart, since the one that drifts is always the one nobody is
 * looking at.
 */
import type { BlockQuery, Filter } from './schema'
import { isAllowedField } from './schema'

/** The operators a URL filter may use. A read-only bar needs no more. */
const URL_OPERATORS = ['is', 'is_not', 'contains'] as const
type UrlOperator = typeof URL_OPERATORS[number]

export interface ReportFilter {
  field: string
  operator: UrlOperator
  value: string
}

/** How many filters one URL may carry, so a crafted link cannot build a huge query. */
export const MAX_URL_FILTERS = 5

/**
 * Read filters out of a query string.
 *
 * The shape is `f=field:operator:value`, repeated. Compact enough to read in a
 * URL bar and to type by hand, which matters because people do share these.
 *
 * Anything malformed is dropped rather than rejected: a link with one bad
 * filter should still show the report, not an error page. A filter silently
 * ignored is visible in the bar, which is where somebody would notice.
 */
export function parseFilters(raw: unknown): ReportFilter[] {
  const entries = Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === '' ? [] : [raw])
  const filters: ReportFilter[] = []

  for (const entry of entries) {
    if (filters.length >= MAX_URL_FILTERS)
      break

    const text = String(entry)
    const first = text.indexOf(':')
    if (first === -1)
      continue

    const field = text.slice(0, first).trim()
    const rest = text.slice(first + 1)
    const second = rest.indexOf(':')
    if (second === -1)
      continue

    const operator = rest.slice(0, second).trim() as UrlOperator
    const value = rest.slice(second + 1).trim()

    // The same allowlist a stored block config is validated against. A URL is
    // the least trustworthy input in the product.
    if (!isAllowedField(field))
      continue

    if (!URL_OPERATORS.includes(operator))
      continue

    // A bounded value, because it reaches a query builder and a URL has no
    // length limit worth relying on.
    if (!value || value.length > 200)
      continue

    filters.push({ field, operator, value })
  }

  return filters
}

/** Back to the query-string form, for building links that keep the filters. */
export function serialiseFilters(filters: ReportFilter[]): string {
  return filters
    .map(filter => `f=${encodeURIComponent(`${filter.field}:${filter.operator}:${filter.value}`)}`)
    .join('&')
}

/**
 * Apply report-wide filters to one block's query.
 *
 * Added to the block's own filters rather than replacing them. A block that was
 * built to count refunds must keep counting refunds when somebody narrows the
 * report to one plan; the report filter narrows, it does not redefine.
 *
 * A funnel is left alone. Its steps are event names rather than a filtered set,
 * and quietly narrowing one would change what the conversion rate is measuring
 * without saying so.
 */
export function applyFilters(query: BlockQuery | undefined | null, filters: ReportFilter[]): BlockQuery | undefined | null {
  if (!query || filters.length === 0)
    return query

  if (Array.isArray(query.steps) && query.steps.length > 0)
    return query

  const existing = Array.isArray(query.filters) ? query.filters : []

  return {
    ...query,
    filters: [...existing, ...filters as Filter[]],
  }
}

/** A sentence naming what is being excluded, for the bar to show. */
export function describeFilters(filters: ReportFilter[], label: (field: string) => string): string {
  if (filters.length === 0)
    return ''

  const words: Record<UrlOperator, string> = { is: 'is', is_not: 'is not', contains: 'contains' }

  return filters
    .map(filter => `${label(filter.field)} ${words[filter.operator]} ${filter.value}`)
    .join(', ')
}
