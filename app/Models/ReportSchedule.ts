import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A recurring delivery of a report by email.
 *
 * The cadence is stored as its parts rather than a cron expression: `daily at
 * 08:00 in Europe/Lisbon` is what a person configures and what the UI has to
 * render back, and reconstructing that from `0 8 * * *` plus a timezone is
 * lossy in exactly the case that matters, a weekly schedule's day.
 *
 * `last_run_at` and `last_status` live here rather than in a log, because the
 * one question anybody asks of a schedule is whether it went out.
 */
export default defineModel({
  name: 'ReportSchedule',
  table: 'report_schedules',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: [{ model: 'Report' }, { model: 'User', foreignKey: 'created_by_id' }],

  traits: {
    useTimestamps: true,
  },

  indexes: [
    // The scan the scheduler runs: everything active, ordered by when it is
    // next due.
    { name: 'report_schedules_active_index', columns: ['is_active', 'next_run_at'] },
    { name: 'report_schedules_report_index', columns: ['report_id'] },
  ],

  attributes: {
    report_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    cadence: {
      fillable: true,
      default: 'weekly',
      validation: { rule: schema.enum(['daily', 'weekly', 'monthly']) },
      factory: () => 'weekly',
    },

    /** Hour of day, 0 to 23, in `timezone`. */
    hour: {
      fillable: true,
      default: 8,
      validation: { rule: schema.number().min(0).max(23) },
      factory: () => 8,
    },

    /** 0 is Sunday. Weekly only. */
    day_of_week: {
      fillable: true,
      validation: { rule: schema.number().min(0).max(6) },
    },

    /** 1 to 28. Monthly only, and capped at 28 so every month has the day. */
    day_of_month: {
      fillable: true,
      validation: { rule: schema.number().min(1).max(28) },
    },

    /**
     * The zone the hour is read in. Copied from the project at creation rather
     * than joined, so moving a project's timezone does not silently reschedule
     * every existing delivery.
     */
    timezone: {
      fillable: true,
      default: 'UTC',
      validation: { rule: schema.string().max(64) },
      factory: () => 'UTC',
    },

    /** Comma-separated addresses. Validated against project membership on save. */
    recipients: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required().max(2000) },
      factory: faker => faker.internet.email().toLowerCase(),
    },

    /** `link` sends the summary and a deep link; the others attach a file. */
    format: {
      fillable: true,
      default: 'link',
      validation: { rule: schema.enum(['link', 'csv', 'xlsx']) },
      factory: () => 'link',
    },

    is_active: {
      fillable: true,
      default: true,
      validation: { rule: schema.boolean() },
      factory: () => true,
    },

    next_run_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    last_run_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    last_status: {
      fillable: true,
      validation: { rule: schema.string().max(200) },
    },

    created_by_id: {
      fillable: true,
      validation: { rule: schema.number() },
    },
  },
})
