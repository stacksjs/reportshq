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

    /**
     * Which version of the rollup computation produced these rows.
     *
     * The companion to `timezone` above, for the other reason existing rows
     * stop being trustworthy: not the data moving, but us changing how it is
     * summarised or stored. Compared before the rollups are trusted, exactly
     * as the zone is.
     *
     * It exists because a schema fix is not a data fix. `value_sum` was an
     * integer column on Postgres, so every stored daily total was truncated to
     * whole units; widening the column corrected what would be written next and
     * left every existing row wrong, and the nightly job only revisits a
     * trailing three days. Without this, the rest stayed quietly wrong forever,
     * and the fix would have looked like it worked.
     */
    build: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },

    built_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },
  },
})
