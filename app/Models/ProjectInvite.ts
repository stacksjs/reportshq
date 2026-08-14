import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A pending invitation to a project, addressed to an email rather than to a
 * user, so it works before the person has an account.
 *
 * Separate from ProjectMember on purpose: an invite is an event that expires
 * and can be revoked, a membership is a standing grant. Keeping them in one
 * table means either an unaccepted invite occupies a seat, or a revoked one
 * leaves a row that still reads as access.
 *
 * The token is the credential. Accepting is the only thing that writes a
 * ProjectMember, which is what keeps access traceable to a link that was sent
 * to that address.
 */
export default defineModel({
  name: 'ProjectInvite',
  table: 'project_invites',
  primaryKey: 'id',
  autoIncrement: true,

  // The only user an invite points at is the person who sent it. Spelling the
  // foreign key out keeps the ORM from adding a `user_id` beside
  // `invited_by_id` for one relationship, and the invitee is deliberately not
  // a relation at all: an invite is addressed to an email that may not have an
  // account yet, which is the entire reason this table is separate.
  belongsTo: [{ model: 'Project' }, { model: 'User', foreignKey: 'invited_by_id' }],

  traits: {
    useTimestamps: true,
  },

  indexes: [
    // Acceptance looks the invite up by token alone, so this is both the hot
    // path and a uniqueness guarantee.
    { name: 'project_invites_token_unique', columns: ['token'], unique: true },
    // Re-inviting an address should update the pending invite rather than
    // stack up a second one that also still works.
    { name: 'project_invites_project_email_index', columns: ['project_id', 'email'] },
  ],

  attributes: {
    project_id: {
      fillable: true,
      required: true,
      validation: { rule: schema.number().required() },
    },

    /**
     * Stored lowercased by the action that creates it, so "Ana@example.com"
     * and "ana@example.com" cannot hold two invites to one project.
     */
    email: {
      fillable: true,
      required: true,
      validation: { rule: schema.string().required().email().max(255) },
      factory: faker => faker.internet.email().toLowerCase(),
    },

    role: {
      fillable: true,
      default: 'member',
      validation: { rule: schema.enum(['admin', 'member']) },
      factory: () => 'member',
    },

    /**
     * 128 bits of randomness, url safe. Long enough that guessing is not a
     * strategy, and unguessable rather than sequential so an invite id cannot
     * be walked.
     */
    token: {
      fillable: true,
      unique: true,
      validation: { rule: schema.string().max(80) },
      factory: () => globalThis.crypto.randomUUID().replace(/-/g, ''),
    },

    /**
     * An invite that is never accepted has to stop working on its own. Seven
     * days by default, set by the action rather than defaulted here so the
     * window is visible where it is decided.
     */
    expires_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    /** Set when the invite becomes a ProjectMember. A row with this set is history. */
    accepted_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },

    /** Set when an owner or admin withdraws the invite before it is accepted. */
    revoked_at: {
      fillable: true,
      validation: { rule: schema.string() },
    },
  },
})
