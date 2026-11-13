import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A pending or approved `buddy hq:connect` attempt.
 *
 * Written by `sqlConnectCodeStore` from `@stacksjs/hq/service`
 * (app/Hq/service.ts), never through this model. The code itself is not
 * stored: `code_hash` is its SHA-256 and `sealed_grant` is the licence
 * encrypted under a key derived from the code, so a copy of this table yields
 * neither a code that can be polled nor a licence.
 */
export default defineModel({
  name: 'HqConnectCode',
  table: 'hq_connect_codes',
  // The hash IS the identity. The store inserts no surrogate id, so there must
  // not be one for it to leave empty.
  primaryKey: 'code_hash',
  autoIncrement: false,

  // No `useApi`: the only way in is the connect contract in routes/hq.ts.
  traits: {
    useTimestamps: true,
  },

  indexes: [
    { name: 'hq_connect_codes_expires_at', columns: ['expires_at'] },
  ],

  attributes: {
    code_hash: { fillable: false, validation: { rule: schema.string().required().max(64) } },
    // The application's name as the CLI sent it, shown on the approve page.
    app: { fillable: false, validation: { rule: schema.string().required().max(64) } },
    // pending | approved | consumed
    status: { fillable: false, validation: { rule: schema.string().required().max(16) } },
    sealed_grant: { fillable: false, validation: { rule: schema.string().optional().max(8192) } },
    // Which caller's guarded UPDATE landed. See sqlConnectCodeStore.
    claim: { fillable: false, validation: { rule: schema.string().optional().max(36) } },
    // Epoch milliseconds, which do not fit 32 bits. `unix()` is the validator
    // that says so: it is what makes the PostgreSQL column a BIGINT, where
    // `number()` would generate a 32-bit INTEGER.
    expires_at: { fillable: false, validation: { rule: schema.unix().required() } },
  },
})
