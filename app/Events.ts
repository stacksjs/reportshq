import type { Events } from '@stacksjs/types'

/**
 * **Events Configuration**
 *
 * This configuration defines all of your events. Because Stacks is fully-typed, you may
 * hover any of the options below and the definitions will be provided. In case you
 * have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  // eventName: ['Listener1', 'Listener2'] -> listeners default to ./app/actions/*
  // Only the framework's own event names are valid here: 0.74 closed the
  // `Events` type, which is what surfaced a second entry for 'user:created'.
  // No such framework event exists and nothing in this app dispatched it, so
  // that listener had never once run. Removed rather than re-pointed —
  // NotifyUser stays, callable directly, and wiring it to a real event is a
  // decision rather than a rename.
  'user:registered': ['SendWelcomeEmail'],
} satisfies Events
