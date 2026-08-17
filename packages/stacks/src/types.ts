/**
 * The shapes the whole package agrees on.
 *
 * Deliberately identical to what `reportshq/laravel` returns and what the
 * compiled chart components read. Three implementations of one product can
 * afford different internals; they cannot afford different answers, and the
 * fastest way to get different answers is a second definition of a series.
 */

/** One point on one series. `t` is a bucket label, not a timestamp to re-parse. */
export interface Point {
  t: string
  value: number
}

/** A series always carries its own total: every consumer needs it. */
export interface Series {
  key: string
  total: number
  points: Point[]
}

export interface QueryResult {
  series: Series[]
  total: number
  grain?: Grain
  comparison?: { change: number | null } | null
}

export type Grain = 'hour' | 'day' | 'week' | 'month'

export const GRAINS: readonly Grain[] = ['hour', 'day', 'week', 'month'] as const

/** How a measure is computed. `count` needs no column; the rest do. */
export type Aggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'

export interface MeasureDescription {
  aggregate: Aggregate
  column?: string
  /** Formatting hint for the chart, never used in the query. */
  unit?: 'number' | 'currency'
}

export interface ModelDescription {
  /** The table the model lives in. Resolved from the model, never guessed. */
  table: string
  /** What may be added up. Nothing outside this is reachable. */
  measures: Record<string, MeasureDescription>
  /** Which columns are dates worth bucketing by. */
  time: Record<string, string>
  /** What may be grouped by. */
  dimensions: Record<string, string>
  /** Relations a dimension may cross, by name to the foreign table and keys. */
  relations?: Record<string, RelationDescription>
}

export interface RelationDescription {
  table: string
  /**
   * The table this relation passes through, when it is not direct.
   *
   * An order reaches a product only by way of its lines, and describing that
   * hop is what makes the fan-out visible instead of implied.
   */
  through?: { table: string, foreignKey: string, ownerKey?: string }
  /** Column on this model holding the foreign key. */
  foreignKey: string
  /** Column on the related table it points at. Defaults to `id`. */
  ownerKey?: string
  /**
   * Whether crossing this relation multiplies rows of the base table.
   *
   * The single most important flag in the file. A measure summed across a
   * one-to-many join counts its row once per match, so revenue by product
   * across order lines counts an order once per line. The compiler refuses
   * rather than answering, because the wrong number is plausible.
   */
  fansOut?: boolean
}

/** A block's query, as stored and as posted by the builder. */
export interface BlockQuery {
  model: string
  measure: string
  dimension?: { model?: string, key: string }
  time?: { model?: string, key: string }
  grain?: Grain
  from?: string
  to?: string
  filters?: Array<{ key: string, op: string, value: unknown }>
  limit?: number
  compare?: boolean
}

export type BlockKind =
  | 'big_number' | 'line' | 'area' | 'bar'
  | 'donut' | 'table' | 'funnel' | 'heatmap' | 'note'

/** A block as the runner returns it: geometry, identity, and either data or a reason. */
export interface RenderedBlock {
  id?: number
  kind: BlockKind
  title?: string
  body?: string
  x: number
  y: number
  w: number
  h: number
  series: Series[]
  total: number
  grain?: Grain
  comparison?: { change: number | null } | null
  /** Null when the block ran. A sentence when it would not, never an exception. */
  error: string | null
}
