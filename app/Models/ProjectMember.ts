import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * An accepted grant of access to a project. The owner is not a row here: they
 * are `projects.owner_id`, and every access check is "owner or member".
 *
 * Keyed by `user_id`, not by email. loghq keys its equivalent table by email so
 * that an invite grants access the moment someone signs up with a matching
 * address, which is genuinely convenient - but it makes the email column an
 * authorisation credential, and any path that lets a user set their own email
 * without verifying it becomes a way to read another tenant's data. Here an
 * invite is a separate, tokened, expiring record (see ProjectInvite) and
 * accepting it is what writes this row, so access always traces back to a
 * link sent to that address.
 *
 * `email` is still stored, for showing who a seat belongs to without a join.
 */
export default defineModel({
  name: 'ProjectMember',
  table: 'project_members',
  primaryKey: 'id',
  autoIncrement: true,

  belongsTo: ['Project', 'User'],

  traits: {
    useTimestamps: true,
  },

  indexes: [
    // One seat per person per project. Accepting the same invite twice, or two
    // invites to the same address, must not produce two rows: the second is a
    // database error rather than a duplicate seat counted against the plan.
    { name: 'project_members_project_user_unique', columns: ['project_id', 'user_id'], unique: true },
    // Every "which projects can I see" query filters on this.
    { name: 'project_members_user_index', columns: ['user_id'] },
  ],

  attributes: {
    project_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    user_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    /** Denormalised for display. Authorisation never reads it. */
    email: {
      fillable: true,
      validation: { rule: schema.string().max(255) },
      factory: faker => faker.internet.email(),
    },

    /**
     * `admin` may invite and remove other members and edit project settings.
     * `member` may read and build reports. Neither may delete the project or
     * change billing; those stay with the owner.
     */
    role: {
      fillable: true,
      default: 'member',
      validation: { rule: schema.enum(['admin', 'member']) },
      factory: () => 'member',
    },

    /** Who sent the invite this seat came from. Kept for the audit trail. */
    invited_by_id: {
      fillable: true,
      validation: { rule: schema.number() },
    },
  },
})
