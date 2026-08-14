import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One tile on a report's grid.
 *
 * `query` and `viz` are JSON columns because their shape depends on `kind`, and
 * modelling nine block types as nullable columns would produce a table that is
 * mostly nulls and a schema change for every new chart. The shape is not
 * unchecked, though: app/Reports/schema.ts validates both, and it is the same
 * definition the builder's config panel and the engine read, so a block cannot
 * be stored asking for something the engine will not answer.
 */
export default defineModel({
  name: 'ReportBlock',
  table: 'report_blocks',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Report' }],

  traits: {
    useTimestamps: true,
  },

  indexes: [
    { name: 'report_blocks_report_index', columns: ['report_id'] },
  ],

  attributes: {
    report_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    kind: {
      fillable: true,
      required: true,
      validation: { rule: schema.enum(['line', 'area', 'bar', 'donut', 'big_number', 'table', 'funnel', 'heatmap', 'text']) },
      factory: () => 'line',
    },

    title: {
      fillable: true,
      validation: { rule: schema.string().max(120) },
      factory: faker => faker.commerce.productName(),
    },

    /** Grid placement on 12 columns. Validated by validateBlockLayout. */
    x: { fillable: true, default: 0, validation: { rule: schema.number() }, factory: () => 0 },
    y: { fillable: true, default: 0, validation: { rule: schema.number() }, factory: () => 0 },
    w: { fillable: true, default: 6, validation: { rule: schema.number() }, factory: () => 6 },
    h: { fillable: true, default: 4, validation: { rule: schema.number() }, factory: () => 4 },

    /** BlockQuery as JSON. Empty for `text` blocks, which render prose. */
    query: {
      fillable: true,
      validation: { rule: schema.string() },
      factory: () => JSON.stringify({ events: [], measure: 'count', filters: [], grain: 'day' }),
    },

    /** Axis labels, palette slot, number format. Presentation only. */
    viz: {
      fillable: true,
      validation: { rule: schema.string() },
      factory: () => '{}',
    },

    /** Prose for a `text` block. Markdown, rendered with our own ts-md. */
    body: {
      fillable: true,
      validation: { rule: schema.string().max(4000) },
    },
  },
})
