/**
 * A block's query, in a sentence.
 *
 * Every chart in this product is an answer to a question nobody can see. Two
 * blocks titled "Revenue" can count different things, and the only way a reader
 * finds out today is to open the builder, which viewers may not be able to do
 * at all. That is how a number gets quoted in a meeting and turns out to have
 * meant something else.
 *
 * So each block can explain itself, in the same vocabulary the builder's
 * pickers use, from the same stored config the engine runs. It cannot drift
 * from what the chart shows, because it is derived from it rather than written
 * alongside it.
 */
import type { BlockQuery, Filter } from './schema'
import { eventLabel, fieldLabel, GRAIN_LABELS, OPERATOR_LABELS } from '../Events/taxonomy'

/** "orders", "signups and sign-ins", "every event". */
function eventsPhrase(events: string[]): string {
  if (events.length === 0)
    return 'every event'

  const labels = events.map(name => eventLabel(name).toLowerCase())

  if (labels.length === 1)
    return labels[0]!

  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** The measure, as something a person would say out loud. */
function measurePhrase(query: BlockQuery): string {
  const field = query.field ? fieldLabel(query.field).toLowerCase() : 'value'

  switch (query.measure) {
    case 'count_unique':
      return 'the number of distinct users'
    case 'sum':
      return `the total ${field}`
    case 'avg':
      return `the average ${field}`
    case 'min':
      return `the smallest ${field}`
    case 'max':
      return `the largest ${field}`
    case 'count':
    default:
      return 'the number of events'
  }
}

/** "where plan is pro", "where currency is present". */
function filterPhrase(filter: Filter): string {
  const field = fieldLabel(filter.field).toLowerCase()
  const operator = OPERATOR_LABELS[filter.operator] ?? filter.operator

  if (filter.operator === 'exists' || filter.operator === 'not_exists')
    return `${field} ${operator}`

  return `${field} ${operator} ${String(filter.value ?? '')}`.trim()
}

/**
 * Describe a block's query.
 *
 * One sentence, no jargon, and it says what the numbers *are* rather than how
 * they were computed. Somebody reading this is deciding whether they can trust
 * a figure, not debugging a query.
 */
export function describeQuery(query: BlockQuery | undefined | null): string {
  if (!query || typeof query !== 'object')
    return 'This block does not read any events.'

  // A funnel is a different shape of question and a sentence about measures
  // and grains would describe the wrong thing entirely.
  if (Array.isArray(query.steps) && query.steps.length > 0) {
    const steps = query.steps.map(name => eventLabel(name).toLowerCase())
    return `How many people who did ${steps[0]} went on to ${steps.slice(1).join(', then ')}.`
  }

  const parts: string[] = [`${measurePhrase(query)} from ${eventsPhrase(query.events ?? [])}`]

  const filters = Array.isArray(query.filters) ? query.filters : []
  if (filters.length > 0)
    parts.push(`where ${filters.map(filterPhrase).join(' and ')}`)

  if (query.dimension)
    parts.push(`split by ${fieldLabel(query.dimension).toLowerCase()}`)

  if (query.grain)
    parts.push((GRAIN_LABELS[query.grain] ?? query.grain).toLowerCase())

  if (query.compare)
    parts.push('compared with the period before')

  const sentence = parts.join(', ')

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/**
 * The caveat a measure carries, when it has one.
 *
 * Separate from the description because it is a different kind of statement: the
 * description says what the number is, this says what it is easy to get wrong
 * about it. Returns an empty string when there is nothing worth warning about,
 * so a block does not carry a note purely because the code could produce one.
 */
export function describeCaveat(query: BlockQuery | undefined | null): string {
  if (!query || typeof query !== 'object')
    return ''

  if (query.measure === 'count_unique')
    return 'Counts distinct user keys, so one person acting twice counts once. This is only meaningful if your events carry a stable user key.'

  if (query.dimension && query.limit)
    return `Only the top ${query.limit} are shown by name; the rest are grouped into Other.`

  return ''
}
