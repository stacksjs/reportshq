import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One project's events for one day and one event name, pre-aggregated.
 *
 * The benchmark in docs/engine-benchmarks.md is why this exists: a 30-day daily
 * line over a million events is ~467ms, and a report is eight of those.
 *
 * Deliberately narrow. It rolls up by (project, day, name) and nothing else,
 * because the alternatives do not work:
 *
 * - **No dimensions.** Rolling up by every property a customer might group by
 *   means a row per (day, name, key, value), which for a high-cardinality
 *   property is larger than the events it summarises.
 * - **No filters.** A filtered question is a different question, and there is
 *   no way to pre-compute one that has not been asked.
 * - **No `count_unique`.** Distinct counts do not compose: summing daily
 *   uniques double-counts anyone who appears on two days. `unique_users` is
 *   stored anyway because it is exact for a single-day question, and the engine
 *   is careful to use it only there.
 *
 * Everything outside that goes to the raw table, which is correct and slower.
 * A rollup that quietly answers a question it cannot answer accurately is worse
 * than no rollup: it is wrong quickly and consistently, which reads as right.
 *
 * `day` is the project-local date, so a project that changes timezone has to
 * rebuild. That is recorded in rebuildProject.
 */
export default defineModel({
  name: 'EventRollup',
  table: 'event_rollups',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Project' }],

  traits: {
    useTimestamps: false,
  },

  indexes: [
    // The lookup, and the guarantee that rebuilding a day cannot leave two
    // rows for it.
    { name: 'event_rollups_unique', columns: ['project_id', 'day', 'name'], unique: true },
    { name: 'event_rollups_project_day_index', columns: ['project_id', 'day'] },
  ],

  attributes: {
    project_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    /** YYYY-MM-DD, in the project's timezone at the time it was built. */
    day: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required().max(10) },
      factory: () => new Date().toISOString().slice(0, 10),
    },

    name: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required().max(120) },
      factory: () => 'commerce.order.created',
    },

    event_count: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },

    value_sum: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },

    /**
     * How many rows had a value at all. `avg` is sum over this, not over
     * `event_count`: averaging across events that carry no value would drag
     * every average toward zero.
     */
    value_count: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },

    value_min: {
      fillable: true,
      validation: { rule: schema.number() },
    },

    value_max: {
      fillable: true,
      validation: { rule: schema.number() },
    },

    /** Exact for a single day. Never summed across days. */
    unique_users: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },

    /** When this row was computed, so a stale rebuild is visible. */
    built_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },
  },
})
