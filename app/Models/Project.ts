import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A project is the unit of tenancy: events arrive against one, reports belong
 * to one, and plan limits are counted per one.
 *
 * No `useApi`. The generated CRUD is not owner-scoped, so `index` would list
 * every project on the instance and `show` would read any of them by id.
 * Project access goes through the owner-scoped routes in routes/projects.ts,
 * which resolve permission through app/Support/access.ts.
 */
export default defineModel({
  name: 'Project',
  table: 'projects',
  primaryKey: 'id',
  autoIncrement: true,

  // Named `owner_id` rather than the default `user_id`. A project has several
  // users on it and exactly one owner, so the column that decides authorisation
  // should say which one it is. Declared through the relation rather than as a
  // plain attribute so the ORM emits one column: writing both gave the table an
  // `owner_id` AND a `user_id` for a single relationship.
  belongsTo: [{ model: 'User', foreignKey: 'owner_id' }],
  hasMany: ['ProjectMember', 'ProjectInvite'],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSoftDeletes: true,
  },

  indexes: [
    // Ingest authenticates by key alone, on every batch, so this lookup is the
    // hottest query in the product and has to be a unique index rather than a
    // scan. Unique also means a duplicate key is a database error rather than
    // two projects quietly sharing a credential.
    { name: 'projects_ingest_key_unique', columns: ['ingest_key'], unique: true },
    { name: 'projects_owner_index', columns: ['owner_id'] },
  ],

  attributes: {
    name: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required().min(1).max(100) },
      factory: faker => `${faker.company.name()} Analytics`,
    },

    slug: {
      fillable: true,
      validation: { rule: schema.string().max(120) },
      factory: faker => faker.lorem.slug(),
    },

    /**
     * The write credential. Public and revocable by design: it ships inside
     * the customer's application, where anything embedded is readable, so it
     * grants exactly one capability - append events to this project - and
     * never read access. Reads use a bearer token.
     *
     * Prefixed so a leaked key is identifiable in a log or a paste, and long
     * enough that guessing is not a strategy: 32 hex characters is 128 bits.
     */
    ingest_key: {
      fillable: true,
      unique: true,
      validation: { rule: schema.string().max(80) },
      factory: () => `rhq_${globalThis.crypto.randomUUID().replace(/-/g, '')}`,
    },

    /**
     * Every report bucket, schedule and retention window is computed in this
     * zone. Stored per project rather than per user because a report is read
     * by a whole team, and "yesterday" has to mean the same day for all of
     * them.
     */
    timezone: {
      fillable: true,
      default: 'UTC',
      validation: { rule: schema.string().max(64) },
      factory: () => 'UTC',
    },

    /**
     * Auto-created reports can be turned off per project, for anyone who would
     * rather build their own from an empty grid. See #14.
     */
    auto_reports_enabled: {
      fillable: true,
      default: true,
      validation: { rule: schema.boolean() },
      factory: () => true,
    },

    /** Set the first time an event is accepted; drives the onboarding state. */
    first_event_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },
  },
})
