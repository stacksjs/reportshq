import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A public, read-only link to one published report.
 *
 * The token is the credential and the only one: a share link is opened by
 * people with no account, which is the point. It therefore carries the
 * narrowest possible authority, one report, and never the project around it.
 *
 * Revoking sets `revoked_at` rather than deleting the row, so "this link was
 * shared and then withdrawn" stays answerable. A deleted row would make a
 * previously-working link indistinguishable from one that never existed.
 */
export default defineModel({
  name: 'ReportShare',
  table: 'report_shares',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Report' }, { model: 'User', foreignKey: 'created_by_id' }],

  traits: {
    useTimestamps: true,
  },

  indexes: [
    { name: 'report_shares_token_unique', columns: ['token'], unique: true },
    { name: 'report_shares_report_index', columns: ['report_id'] },
  ],

  attributes: {
    report_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    /** 128 bits, url safe. Long enough that guessing is not a strategy. */
    token: {
      fillable: true,
      unique: true,
      required: true,
      validation: { rule: schema.string().required().max(80) },
      factory: () => globalThis.crypto.randomUUID().replace(/-/g, ''),
    },

    /** Optional label, so a list of links says which is which. */
    label: {
      fillable: true,
      validation: { rule: schema.string().max(120) },
    },

    /** Null means it does not expire on its own. */
    expires_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    revoked_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    /** Best-effort counter, for "is anyone actually reading this". */
    view_count: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
      factory: () => 0,
    },

    last_viewed_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    /** Whether the page carries our footer. Removing it is a Pro perk (#18). */
    show_branding: {
      fillable: true,
      default: true,
      validation: { rule: schema.boolean() },
      factory: () => true,
    },

    created_by_id: {
      fillable: true,
      validation: { rule: schema.number() },
    },
  },
})
