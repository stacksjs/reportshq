import type { Aggregate, Grain, ModelDescription, RelationDescription } from './types'
import { GRAINS } from './types'

/**
 * What may be asked, and of what.
 *
 * **This is an allowlist, not a hint.** Nothing outside a description is
 * reachable by a query, which is the property that lets a block's configuration
 * arrive from a browser at all. Adding a column to a model does not expose it;
 * adding it here does. Without that rule, a dimension key in a URL is a column
 * name in a SELECT, and somebody eventually types `password`.
 *
 * A description names its own table rather than deriving one from the model
 * name. Pluralisation rules are a bad thing to bet a query on, and a model
 * whose table is `people` should not need the registry to know English.
 */
export class Registry {
  private readonly models = new Map<string, ModelDescription>()

  constructor(descriptions: Record<string, ModelDescription> = {}) {
    for (const [key, description] of Object.entries(descriptions))
      this.describe(key, description)
  }

  describe(key: string, description: ModelDescription): this {
    this.models.set(key, description)
    return this
  }

  has(key: string): boolean {
    return this.models.has(key)
  }

  /** The description, or a refusal naming what was asked for. */
  model(key: string): ModelDescription {
    const found = this.models.get(key)

    if (!found)
      throw new SemanticError(`No model called '${key}' has been described.`)

    return found
  }

  keys(): string[] {
    return [...this.models.keys()].sort()
  }

  measure(modelKey: string, measureKey: string): { aggregate: Aggregate, column?: string } {
    const model = this.model(modelKey)
    const measure = model.measures[measureKey]

    if (!measure) {
      throw new SemanticError(
        `'${modelKey}' has no measure called '${measureKey}'. It has: ${Object.keys(model.measures).join(', ') || 'none'}.`,
      )
    }

    if (measure.aggregate !== 'count' && !measure.column)
      throw new SemanticError(`Measure '${measureKey}' is a ${measure.aggregate} and needs a column.`)

    return measure
  }

  /** The column a dimension names, checked against the allowlist. */
  dimension(modelKey: string, dimensionKey: string): string {
    const model = this.model(modelKey)
    const column = model.dimensions[dimensionKey]

    if (!column) {
      throw new SemanticError(
        `'${modelKey}' has no dimension called '${dimensionKey}'. It has: ${Object.keys(model.dimensions).join(', ') || 'none'}.`,
      )
    }

    return column
  }

  /** The date column a time key names. */
  time(modelKey: string, timeKey: string): string {
    const model = this.model(modelKey)
    const column = model.time[timeKey]

    if (!column) {
      throw new SemanticError(
        `'${modelKey}' has no time key called '${timeKey}'. It has: ${Object.keys(model.time).join(', ') || 'none'}.`,
      )
    }

    return column
  }

  /**
   * The path from one model to another, or a refusal.
   *
   * Only a directly described relation. No search for a route through a third
   * table: a join the author did not write is a join nobody reviewed, and the
   * number it produces is one nobody can explain.
   */
  relation(fromKey: string, toKey: string): RelationDescription & { name: string } {
    const from = this.model(fromKey)
    const relations = from.relations ?? {}

    for (const [name, relation] of Object.entries(relations)) {
      if (relation.table === this.model(toKey).table)
        return { ...relation, name }
    }

    throw new SemanticError(
      `'${fromKey}' has no described relation to '${toKey}'. Describe one on '${fromKey}' if the two are meant to be joined.`,
    )
  }

  static grain(value: unknown): Grain {
    if (typeof value === 'string' && (GRAINS as readonly string[]).includes(value))
      return value as Grain

    throw new SemanticError(`'${String(value)}' is not a grain. Use one of: ${GRAINS.join(', ')}.`)
  }

  /** Everything the builder may offer, which is exactly what the compiler accepts. */
  choices(): {
    models: Array<{ key: string, measures: string[], dimensions: string[], time: string[] }>
    grains: readonly Grain[]
  } {
    return {
      models: this.keys().map((key) => {
        const model = this.model(key)

        return {
          key,
          measures: Object.keys(model.measures),
          dimensions: Object.keys(model.dimensions),
          time: Object.keys(model.time),
        }
      }),
      grains: GRAINS,
    }
  }
}

/**
 * A refusal, not a crash.
 *
 * Carried to the block it belongs to and rendered on its face. One question
 * nobody can answer is not a failed page, and a reader who sees an empty tile
 * with no reason assumes the week was quiet.
 */
export class SemanticError extends Error {
  readonly isRefusal = true
}
