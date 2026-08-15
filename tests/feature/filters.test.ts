/**
 * Report-wide filters from the URL.
 *
 * These values arrive from a query string, which anybody can edit, and they end
 * up in a query. Most of what follows is about what must be refused.
 */
import { describe, expect, test } from 'bun:test'
import { applyFilters, describeFilters, MAX_URL_FILTERS, parseFilters, serialiseFilters } from '../../app/Reports/filters'

const label = (field: string) => field.replace('properties.', '')

describe('parsing filters from a URL', () => {
  test('reads the documented shape', () => {
    expect(parseFilters('properties.plan:is:pro')).toEqual([
      { field: 'properties.plan', operator: 'is', value: 'pro' },
    ])
  })

  test('reads several', () => {
    const parsed = parseFilters(['properties.plan:is:pro', 'currency:is:USD'])
    expect(parsed).toHaveLength(2)
  })

  test('a value containing a colon survives', () => {
    // Splitting on every colon would truncate a URL or a timestamp, and the
    // value is the part most likely to contain one.
    expect(parseFilters('properties.source:is:https://example.com')[0]!.value).toBe('https://example.com')
  })

  test('a field outside the allowlist is dropped', () => {
    // The same list a stored block config is validated against. A second check
    // written here would be the one that drifts.
    expect(parseFilters('password:is:secret')).toEqual([])
    expect(parseFilters('users.email:is:a@b.c')).toEqual([])
  })

  test('an operator the bar does not offer is dropped', () => {
    // A read-only bar has no business running `gt` or `exists` against a URL.
    expect(parseFilters('value:gt:100')).toEqual([])
    expect(parseFilters('properties.plan:drop:pro')).toEqual([])
  })

  test('malformed entries are ignored rather than failing the page', () => {
    // A link with one bad filter should still show the report.
    expect(parseFilters('nonsense')).toEqual([])
    expect(parseFilters('properties.plan:is:')).toEqual([])
    expect(parseFilters(['properties.plan:is:pro', 'nonsense'])).toHaveLength(1)
  })

  test('an absurd value is refused', () => {
    expect(parseFilters(`properties.plan:is:${'x'.repeat(500)}`)).toEqual([])
  })

  test('a crafted link cannot build an unbounded query', () => {
    const many = Array.from({ length: 50 }, (_, i) => `properties.plan:is:v${i}`)
    expect(parseFilters(many)).toHaveLength(MAX_URL_FILTERS)
  })

  test('nothing is an empty list', () => {
    expect(parseFilters(undefined)).toEqual([])
    expect(parseFilters('')).toEqual([])
  })
})

describe('applying them to a block', () => {
  const query = { events: ['commerce.order.created'], measure: 'count' as const, filters: [{ field: 'currency', operator: 'is' as const, value: 'USD' }] }

  test('the block keeps its own filters', () => {
    // A block built to count refunds must keep counting refunds when somebody
    // narrows the report; the report filter narrows, it does not redefine.
    const applied = applyFilters(query, [{ field: 'properties.plan', operator: 'is', value: 'pro' }])

    expect(applied!.filters).toHaveLength(2)
    expect(applied!.filters[0]!.field).toBe('currency')
  })

  test('no filters leaves the query untouched', () => {
    expect(applyFilters(query, [])).toBe(query)
  })

  test('a funnel is left alone', () => {
    // Its steps are event names rather than a filtered set, and narrowing one
    // silently would change what the conversion rate measures.
    const funnel = { events: [], measure: 'count' as const, filters: [], steps: ['a.b', 'c.d'] }
    expect(applyFilters(funnel, [{ field: 'properties.plan', operator: 'is', value: 'pro' }])).toBe(funnel)
  })

  test('a missing query stays missing', () => {
    expect(applyFilters(null, [{ field: 'properties.plan', operator: 'is', value: 'pro' }])).toBeNull()
  })
})

describe('round tripping', () => {
  test('serialising and parsing gives back what went in', () => {
    const filters = [
      { field: 'properties.plan', operator: 'is' as const, value: 'pro' },
      { field: 'currency', operator: 'is_not' as const, value: 'EUR' },
    ]

    const query = serialiseFilters(filters)
    const parsed = parseFilters(query.split('&').map(part => decodeURIComponent(part.replace('f=', ''))))

    expect(parsed).toEqual(filters)
  })

  test('a value with a space or an ampersand survives the URL', () => {
    const filters = [{ field: 'properties.source', operator: 'is' as const, value: 'paid & organic' }]
    const parsed = parseFilters(serialiseFilters(filters).split('&f=').map((part, index) =>
      decodeURIComponent(index === 0 ? part.replace('f=', '') : part)))

    expect(parsed[0]!.value).toBe('paid & organic')
  })
})

describe('describing them', () => {
  test('reads as a sentence', () => {
    expect(describeFilters([
      { field: 'properties.plan', operator: 'is', value: 'pro' },
      { field: 'currency', operator: 'is_not', value: 'EUR' },
    ], label)).toBe('plan is pro, currency is not EUR')
  })

  test('nothing describes as nothing', () => {
    expect(describeFilters([], label)).toBe('')
  })
})
