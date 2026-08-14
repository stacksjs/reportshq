import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * Which days a project's rollups actually cover.
 *
 * Without this the engine cannot tell "no events that day" from "never built",
 * because a day with no events deliberately stores no rows. It answered the
 * first correctly and the second with zeros, which is the exact failure the
 * rollup design set out to avoid: wrong quickly and consistently, in a way that
 * reads as correct.
 *
 * So coverage is recorded explicitly, and the engine only reads the
 * pre-aggregate for a range that sits entirely inside it. Anything outside
 * goes to the raw table and is right.
 */
export default defineModel({
  name: 'RollupState',
  table: 'rollup_states',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Project' }],

  traits: {
    useTimestamps: false,
  },

  indexes: [
    { name: 'rollup_states_project_unique', columns: ['project_id'], unique: true },
  ],

  attributes: {
    project_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    /** Earliest project-local day covered, YYYY-MM-DD. */
    covered_from: {
      fillable: true,
      validation: { rule: schema.string().max(10) },
    },

    /** Latest project-local day covered, inclusive. */
    covered_through: {
      fillable: true,
      validation: { rule: schema.string().max(10) },
    },

    /**
     * The timezone the coverage was built in. A project that changes zone
     * invalidates every existing row, because `day` is a local date, so this
     * is compared before the rollups are trusted.
     */
    timezone: {
      fillable: true,
      default: 'UTC',
      validation: { rule: schema.string().max(64) },
      factory: () => 'UTC',
    },

    built_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },
  },
})
