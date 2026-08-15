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
     *
     * `upgrade` is written by the template engine before it rewrites an
     * auto-created report onto a newer template. It is deliberately not an
     * `autosave`: a person's own edits are what make a report theirs, and
     * "has this been edited by a human" is the question the engine asks before
     * it touches anything. Filing its own writes under the same reason would
     * make the engine's first upgrade look like an edit and freeze every
     * subsequent one.
     */
    reason: {
      fillable: true,
      default: 'autosave',
      validation: { rule: schema.enum(['autosave', 'publish', 'restore', 'upgrade']) },
      factory: () => 'autosave',
    },

    created_by_id: {
      fillable: true,
      validation: { rule: schema.number() },
    },
  },
})
