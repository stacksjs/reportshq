/**
 * What a block asks the engine for.
 *
 * One definition, shared three ways: the model validates against it before a
 * block is stored, the builder's config panel is generated from it, and the
 * engine (#10) reads it to build a query. Writing it three times is how a
 * measure ends up meaning one thing in the UI and another in the SQL.
 *
 * Kept as plain types plus a validator rather than a class, because it travels:
 * a block config is JSON in a column, JSON on the wire, and JSON in a report
 * template shipped in the repository.
 */

/** What the numbers are. */
export type Measure =
  /** Rows. The default, and what a count of events means. */
  | 'count'
  /** Distinct `user_key`. Unique visitors, active users, buyers. */
  | 'count_unique'
  /** Sum of `value`. Revenue, duration, quantity. */
  | 'sum'
  /** Mean of `value`. Order value, session length. */
  | 'avg'
  | 'min'
  | 'max'

/** How time is bucketed. */
export type Grain = 'hour' | 'day' | 'week' | 'month'

/** How a filter compares. */
export type Operator = 'is' | 'is_not' | 'contains' | 'starts_with' | 'gt' | 'lt' | 'exists' | 'not_exists'

export interface Filter {
  /** `name`, `user_key`, `session_key`, `value`, or `properties.<key>`. */
  field: string
  operator: Operator
  /** Absent for `exists` and `not_exists`. */
  value?: string | number | boolean
}

export type BlockKind =
  | 'line'
  | 'area'
  | 'bar'
  | 'donut'
  | 'big_number'
  | 'table'
  | 'funnel'
  | 'heatmap'
  | 'text'

export interface BlockQuery {
  /** Event names this block reads. Empty means every event in the project. */
  events: string[]
  measure: Measure
  /** Required by `sum`, `avg`, `min` and `max`; ignored by the others. */
  field?: string
  /** Group into series by this field. Bounded by `limit` with an "other" bucket. */
  dimension?: string
  filters: Filter[]
  grain?: Grain
  /** Compare against the previous period of equal length. */
  compare?: boolean
  /** Top N series when a dimension is set. */
  limit?: number
  /** Ordered steps, funnel blocks only. */
  steps?: string[]
}

export interface BlockLayout {
  x: number
  y: number
  w: number
  h: number
}

export const GRID_COLUMNS = 12
export const MAX_SERIES = 20

/** Measures that need a numeric field to operate on. */
const FIELD_MEASURES: Measure[] = ['sum', 'avg', 'min', 'max']

const MEASURES: Measure[] = ['count', 'count_unique', 'sum', 'avg', 'min', 'max']
const GRAINS: Grain[] = ['hour', 'day', 'week', 'month']
const OPERATORS: Operator[] = ['is', 'is_not', 'contains', 'starts_with', 'gt', 'lt', 'exists', 'not_exists']
const KINDS: BlockKind[] = ['line', 'area', 'bar', 'donut', 'big_number', 'table', 'funnel', 'heatmap', 'text']

/** Operators that carry no value, because the test is presence. */
const VALUELESS: Operator[] = ['exists', 'not_exists']

/**
 * Fields a filter or dimension may name.
 *
 * An allowlist rather than a pattern: these names reach a query builder, and
 * "anything matching an identifier" is how a column name becomes an injection
 * point the day someone builds the query with a template string instead. The
 * `properties.` prefix is open because the bag is the customer's own, and it is
 * read through a JSON accessor rather than as a column.
 */
const COLUMN_FIELDS = ['name', 'user_key', 'session_key', 'value', 'currency', 'occurred_at']

export function isAllowedField(field: string): boolean {
  if (COLUMN_FIELDS.includes(field))
    return true

  if (!field.startsWith('properties.'))
    return false

  const key = field.slice('properties.'.length)
  // The same bound normalisation applies to property keys on the way in, so a
  // filter can only name something that could have been stored.
  return key.length > 0 && key.length <= 64 && !/["'\\]/.test(key)
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate a block query.
 *
 * Returns every problem rather than the first, because this drives a config
 * panel: fixing one field only to be told about the next is a worse experience
 * than being shown all three at once.
 */
export function validateBlockQuery(input: unknown): ValidationResult {
  const errors: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { valid: false, errors: ['A block query must be an object.'] }

  const query = input as Partial<BlockQuery>

  if (!Array.isArray(query.events))
    errors.push('`events` must be an array, empty to read every event.')
  else if (query.events.some(event => typeof event !== 'string' || !event.trim()))
    errors.push('Every entry in `events` must be a non-empty event name.')

  if (!query.measure || !MEASURES.includes(query.measure))
    errors.push(`\`measure\` must be one of: ${MEASURES.join(', ')}.`)

  if (query.measure && FIELD_MEASURES.includes(query.measure)) {
    if (!query.field)
      errors.push(`\`${query.measure}\` needs a \`field\` to operate on.`)
    else if (!isAllowedField(query.field))
      errors.push(`\`field\` names something that cannot be read: ${query.field}.`)
  }

  if (query.dimension !== undefined && !isAllowedField(query.dimension))
    errors.push(`\`dimension\` names something that cannot be read: ${query.dimension}.`)

  if (query.grain !== undefined && !GRAINS.includes(query.grain))
    errors.push(`\`grain\` must be one of: ${GRAINS.join(', ')}.`)

  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_SERIES)
      errors.push(`\`limit\` must be a whole number between 1 and ${MAX_SERIES}.`)
  }

  if (query.filters !== undefined) {
    if (!Array.isArray(query.filters)) {
      errors.push('`filters` must be an array.')
    }
    else {
      query.filters.forEach((filter, index) => {
        const label = `filters[${index}]`

        if (!filter || typeof filter !== 'object') {
          errors.push(`${label} must be an object.`)
          return
        }

        if (!filter.field || !isAllowedField(filter.field))
          errors.push(`${label}.field names something that cannot be read.`)

        if (!filter.operator || !OPERATORS.includes(filter.operator)) {
          errors.push(`${label}.operator must be one of: ${OPERATORS.join(', ')}.`)
          return
        }

        const needsValue = !VALUELESS.includes(filter.operator)
        if (needsValue && (filter.value === undefined || filter.value === null || filter.value === ''))
          errors.push(`${label} needs a value for \`${filter.operator}\`.`)

        if (!needsValue && filter.value !== undefined)
          errors.push(`${label} takes no value with \`${filter.operator}\`.`)
      })
    }
  }

  if (query.steps !== undefined) {
    if (!Array.isArray(query.steps) || query.steps.length < 2)
      errors.push('A funnel needs at least two `steps`.')
  }

  return { valid: errors.length === 0, errors }
}

/** Validate a block's placement on the grid. */
export function validateBlockLayout(input: unknown): ValidationResult {
  const errors: string[] = []

  if (!input || typeof input !== 'object')
    return { valid: false, errors: ['A block layout must be an object.'] }

  const layout = input as Partial<BlockLayout>

  for (const key of ['x', 'y', 'w', 'h'] as const) {
    if (!Number.isInteger(layout[key]) || (layout[key] as number) < 0)
      errors.push(`\`${key}\` must be a whole number of grid units.`)
  }

  if (errors.length > 0)
    return { valid: false, errors }

  if ((layout.w as number) < 1 || (layout.w as number) > GRID_COLUMNS)
    errors.push(`\`w\` must be between 1 and ${GRID_COLUMNS}.`)

  if ((layout.h as number) < 1)
    errors.push('`h` must be at least 1.')

  // A block that starts inside the grid and ends outside it is the shape a
  // drag produces at the right-hand edge, so it is worth naming precisely
  // rather than reporting as a bad `x`.
  if ((layout.x as number) + (layout.w as number) > GRID_COLUMNS)
    errors.push(`A block at x=${layout.x} cannot be ${layout.w} wide; the grid is ${GRID_COLUMNS} columns.`)

  return { valid: errors.length === 0, errors }
}

/** Blocks that render data, and therefore need a query. `text` does not. */
export function needsQuery(kind: BlockKind): boolean {
  return kind !== 'text'
}

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === 'string' && KINDS.includes(value as BlockKind)
}

export { GRAINS, KINDS, MEASURES, OPERATORS }
