import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A report: a named grid of blocks over one project's events.
 *
 * Two ways one comes to exist, and `origin` records which. A user builds it in
 * the builder (#12), or a template provisions it because matching events
 * started arriving (#14). The distinction matters later: a template report can
 * offer to update itself when its template version moves, and a user's cannot,
 * because there is nothing to update it from.
 *
 * No `useApi`: reports belong to projects, and the generated CRUD is scoped to
 * neither.
 */
export default defineModel({
  name: 'Report',
  table: 'reports',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Project' }, { model: 'User', foreignKey: 'created_by_id' }],
  hasMany: ['ReportBlock', 'ReportRevision', 'ReportSchedule', 'ReportShare', 'ReportExport'],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSoftDeletes: true,
  },

  indexes: [
    { name: 'reports_project_slug_unique', columns: ['project_id', 'slug'], unique: true },
    // Provisioning is idempotent on this pair: a template that has already
    // produced a report for a project must never produce a second one, even
    // when the first was deleted. See #14.
    { name: 'reports_project_template_index', columns: ['project_id', 'template_key'] },
  ],

  attributes: {
    project_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    name: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required().min(1).max(120) },
      factory: faker => `${faker.commerce.department()} overview`,
    },

    /** Unique within a project, so a report has a readable URL. */
    slug: {
      fillable: true,
      validation: { rule: schema.string().max(140) },
      factory: faker => faker.lorem.slug(),
    },

    description: {
      fillable: true,
      validation: { rule: schema.string().max(500) },
    },

    /**
     * `draft` is what the builder edits; `published` is what viewers and share
     * links see. Publishing snapshots the draft, so a half-finished edit is
     * never what a teammate opens.
     */
    status: {
      fillable: true,
      default: 'draft',
      validation: { rule: schema.enum(['draft', 'published']) },
      factory: () => 'draft',
    },

    /**
     * When the current published snapshot was taken.
     *
     * Shown to viewers, because a report's numbers and the moment its layout was
     * frozen are different facts, and somebody looking at a stale dashboard
     * deserves to be told which one they are reading.
     */
    published_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    /**
     * Whether the draft has moved on since the last publish.
     *
     * A flag rather than a timestamp comparison. The obvious version is "is any
     * block newer than the last publish revision", but both sides are stored to
     * the second, and a publish that lands in the same second as the edit it
     * captures then reads as stale forever. This is set by every write to a
     * block and cleared by publishing, so it cannot disagree with itself.
     */
    unpublished_changes: {
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
      factory: () => false,
    },

    origin: {
      fillable: true,
      default: 'user',
      validation: { rule: schema.enum(['user', 'template']) },
      factory: () => 'user',
    },

    /** Which template produced it, and at which version. Null for user reports. */
    template_key: {
      fillable: true,
      validation: { rule: schema.string().max(120) },
    },

    template_version: {
      fillable: true,
      validation: { rule: schema.number() },
    },

    /**
     * The range a viewer sees before touching the date picker, as a relative
     * token (`last_7_days`, `last_30_days`, `this_month`) rather than dates.
     * Absolute dates would age: a report saved in June should not still open
     * on June when read in September.
     */
    default_range: {
      fillable: true,
      default: 'last_30_days',
      validation: { rule: schema.string().max(40) },
      factory: () => 'last_30_days',
    },

    created_by_id: {
      fillable: true,
      validation: { rule: schema.number() },
    },
  },
})
