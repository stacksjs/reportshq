import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A licence: one installed application on one account.
 *
 * Issued when a signed-in person approves `buddy hq:connect reportshq`
 * (app/Hq/adapter.ts), and listed on the account page. The key is what the
 * application stores as `REPORTSHQ_LICENSE`.
 *
 * The key is kept as issued, not hashed. It is not a credential to anything
 * here: no endpoint accepts it, and the package that reads it checks its shape
 * offline and gates nothing on it (packages/stacks/src/license.ts). What it
 * has to do is be shown again to the person it belongs to, who needs the same
 * key in every environment the application runs in.
 *
 * How many an account may have is the plan's `applications` allowance
 * (app/Billing/limits.ts), checked when one is issued.
 */
export default defineModel({
  name: 'License',
  table: 'licenses',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: ['User'],

  // No `useApi`. The generated CRUD is not scoped to the requesting user, so
  // `index` would list every account's licence keys. The only ways in are the
  // connect contract in routes/hq.ts and the account page.
  traits: {
    useTimestamps: true,
  },

  indexes: [
    { name: 'licenses_user_id_application', columns: ['user_id', 'application'] },
  ],

  attributes: {
    // The application's name as `buddy hq:connect` sent it: the app's own
    // APP_NAME. Compared case-insensitively when a connect looks for it.
    application: {
      fillable: false,
      validation: { rule: schema.string().required().max(64) },
    },
    // `rhq_lic_` and 32 hex characters.
    license_key: {
      fillable: false,
      unique: true,
      hidden: true,
      validation: { rule: schema.string().required().max(40) },
    },
  },
})
