import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One thing that happened in a customer's application.
 *
 * An append-only stream, deliberately: events are never edited and never
 * deduplicated after the fact, because a report that changes retroactively is a
 * report nobody can act on. Corrections are new events.
 *
 * No `useApi`. The generated CRUD is unscoped, and this is the table that holds
 * every tenant's data; reads go through the project-scoped routes, which
 * resolve permission through app/Support/access.ts first.
 *
 * No `useTimestamps` either. A row here has two times that matter and they are
 * not the same: `occurred_at` is when it happened in the customer's world, and
 * `received_at` is when we saw it. Reports bucket on the first; the second is
 * what explains a gap. An `updated_at` on an append-only table would only ever
 * be a lie.
 */
export default defineModel({
  name: 'Event',
  table: 'events',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Project' }],

  traits: {
    useTimestamps: false,
  },

  indexes: [
    // The shape of nearly every query the engine will run: one project, one
    // event name, a time range, newest first. Ordered project first because it
    // is the only predicate that is always present.
    { name: 'events_project_name_time_index', columns: ['project_id', 'name', 'occurred_at'] },
    // Time-range queries that do not filter by name: totals, active users, the
    // "waiting for first event" check.
    { name: 'events_project_time_index', columns: ['project_id', 'occurred_at'] },
    // Unique-visitor and retention questions group by this.
    { name: 'events_project_user_index', columns: ['project_id', 'user_key'] },
  ],

  attributes: {
    project_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    /**
     * Dot-separated taxonomy: `commerce.order.created`, `user.registered`.
     *
     * The name is the contract between an integration and a report template.
     * Reserved prefixes and their required properties are documented in
     * docs/events.md, which is what the SDKs (#7, #8) and the auto-report
     * templates (#14) are both written against.
     */
    name: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required().min(1).max(120) },
      factory: () => 'commerce.order.created',
    },

    /**
     * When it happened, in the customer's world.
     *
     * Sent by the client and therefore not trustworthy: clocks drift, phones
     * are wrong, and a replayed backfill will claim any date it likes. The
     * ingest clamps it to a sane window around `received_at` rather than
     * rejecting the batch, because a slightly wrong clock should not cost a
     * customer their data.
     */
    occurred_at: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required() },
    },

    /** When we accepted it. Server clock, never the client's. */
    received_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    /**
     * Arbitrary JSON, bounded. Stored as text rather than a JSON column so the
     * same schema works on SQLite and Postgres alike; the engine reads it
     * through the driver's JSON functions.
     */
    properties: {
      fillable: true,
      // text, not string: a plain string becomes varchar(255), and a property
      // bag is JSON that routinely exceeds it. SQLite ignores the declared
      // width, so an oversized bag stored fine there and was rejected by
      // Postgres with "value too long for type character varying(255)".
      validation: { rule: schema.text() },
    },

    /**
     * The number a report sums or averages: order total, subscription value,
     * duration. Nullable, because most events do not have one, and a zero
     * would drag every average toward it.
     */
    value: {
      fillable: true,
      // float, not number: an order total is 99.5 as often as it is 100, and
      // `number()` maps to an integer column, which stored 99.5 as 100 without
      // an error at any layer. SQLite does not enforce the declared type, so
      // this only ever showed up on Postgres.
      validation: { rule: schema.float() },
    },

    /** ISO 4217, present only when `value` is money. */
    currency: {
      fillable: true,
      validation: { rule: schema.string().max(3) },
    },

    /**
     * The customer's own pseudonymous id for the person involved. Unique
     * counts, repeat rate and retention are computed from it.
     *
     * Deliberately opaque to us: an integration is told to send a stable
     * internal id or a hash, never an email address, so this table does not
     * accumulate identities we have no reason to hold.
     */
    user_key: {
      fillable: true,
      validation: { rule: schema.string().max(120) },
    },

    /** Groups events from one visit. Funnels use it to order steps. */
    session_key: {
      fillable: true,
      validation: { rule: schema.string().max(120) },
    },
  },
})
