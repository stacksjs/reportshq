import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A requested file rendering of a report.
 *
 * Bookkeeping for work that happens elsewhere: a queued job builds the file and
 * updates the row. It exists so the UI can show progress and history rather
 * than a spinner that means nothing, and so a failed export says why instead of
 * disappearing.
 *
 * Files expire. An export is a snapshot of numbers at a moment, and keeping
 * them forever means keeping every customer's data in object storage long after
 * anyone wanted it.
 */
export default defineModel({
  name: 'ReportExport',
  table: 'report_exports',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Report' }, { model: 'User', foreignKey: 'requested_by_id' }],

  traits: {
    useTimestamps: true,
  },

  indexes: [
    { name: 'report_exports_report_index', columns: ['report_id', 'id'] },
    // The sweep that deletes expired files looks for exactly this.
    { name: 'report_exports_expiry_index', columns: ['expires_at'] },
  ],

  attributes: {
    report_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    format: {
      fillable: true,
      required: true,
      validation: { rule: schema.enum(['csv', 'xlsx']) },
      factory: () => 'csv',
    },

    status: {
      fillable: true,
      default: 'pending',
      validation: { rule: schema.enum(['pending', 'running', 'ready', 'failed']) },
      factory: () => 'pending',
    },

    /** The range the export covers, resolved to absolute dates at request time. */
    range_from: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    range_to: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    /** Where the file lives, through @stacksjs/storage. Null until ready. */
    path: {
      fillable: true,
      validation: { rule: schema.string().max(500) },
    },

    size_bytes: {
      fillable: true,
      validation: { rule: schema.number() },
    },

    /** Why it failed, shown to the person who asked rather than only logged. */
    error: {
      fillable: true,
      validation: { rule: schema.string().max(500) },
    },

    expires_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    requested_by_id: {
      fillable: true,
      validation: { rule: schema.number() },
    },
  },
})
