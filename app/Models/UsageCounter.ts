import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * How many events a project took in a given month.
 *
 * A counter rather than a `COUNT(*)` over the events table, and that is the
 * whole reason this model exists. The count is read on the ingest path, which
 * is the one request that must stay cheap, and it has to keep being correct
 * after retention deletes the rows it counted. A project that sent four million
 * events in March and had them pruned in June still used four million events in
 * March, and its bill should say so.
 *
 * Keyed by calendar month in the project's own timezone, so a month boundary
 * means the same thing to the customer as it does to the invoice.
 */
export default defineModel({
  name: 'UsageCounter',
  table: 'usage_counters',

  traits: {
    useTimestamps: true,
    // No useApi: usage is read through the billing surface, which scopes it to
    // projects the caller can see. Generated CRUD would expose every tenant's
    // volumes to anyone signed in.
  },

  belongsTo: ['Project'],

  indexes: [
    {
      name: 'usage_counters_project_month_unique',
      columns: ['project_id', 'month'],
      unique: true,
    },
  ],

  attributes: {
    project_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    /** `YYYY-MM`, in the project's timezone. */
    month: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required().max(7) },
      factory: () => new Date().toISOString().slice(0, 7),
    },

    /** Events accepted, including any accepted inside the grace band. */
    events: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },

    /**
     * Events refused for being past the grace band.
     *
     * Counted rather than forgotten. "We dropped some of your data" is a thing
     * a customer is owed a number for, and without this the meter and the
     * database would disagree with no way to explain the gap.
     */
    rejected: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },

    /**
     * The highest usage threshold already notified about, as a percentage.
     *
     * Stops the nag storm: 80 is written when the first warning goes out, 100
     * when the quota is reached, and neither is sent twice in a month.
     */
    notified_at_percent: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },
  },
})
