import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * An autosaved snapshot of a report's whole layout.
 *
 * The builder writes one as edits settle, so undo survives a reload and a
 * misjudged drag is never permanent. Whole-report rather than per-block
 * because a layout change moves several blocks at once, and restoring half of
 * one is worse than not restoring at all.
 *
 * Pruned per report by the builder (#12); an unbounded revision table would
 * grow faster than the reports themselves.
 */
export default defineModel({
  name: 'ReportRevision',
  table: 'report_revisions',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Report' }, { model: 'User', foreignKey: 'created_by_id' }],

  traits: {
    useTimestamps: true,
  },

  indexes: [
    { name: 'report_revisions_report_index', columns: ['report_id', 'id'] },
  ],

  attributes: {
    report_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    /** The blocks, serialised. Restoring replaces the live set with this. */
    snapshot: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required() },
      factory: () => JSON.stringify({ blocks: [] }),
    },

    /**
     * `autosave` is written as edits settle; `publish` marks what was served
     * to viewers at a point in time. Both are restorable, and the distinction
     * is what lets a "restore last published" exist.
     */
    reason: {
      fillable: true,
      default: 'autosave',
      validation: { rule: schema.enum(['autosave', 'publish', 'restore']) },
      factory: () => 'autosave',
    },

    created_by_id: {
      fillable: true,
      validation: { rule: schema.number() },
    },
  },
})
