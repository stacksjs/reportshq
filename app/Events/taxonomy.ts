/**
 * Human names for the events in the taxonomy.
 *
 * The builder's pickers list whatever a project has actually sent, and raw
 * names are the wrong thing to choose from: `commerce.order.refunded` beside
 * `commerce.order.cancelled` in a dropdown is two strings that differ in one
 * word near the end, which is exactly how somebody builds a refunds chart out
 * of cancellations.
 *
 * Only the documented events get a hand-written label. Everything else is a
 * custom event belonging to the customer, and `humanize` makes it readable
 * without pretending to know what it means. A test asserts every event in
 * docs/events.md appears here, because a name documented for the SDKs and
 * missing from this map is how the two drift apart.
 */
export const EVENT_LABELS: Record<string, string> = {
  'commerce.order.created': 'Order placed',
  'commerce.order.paid': 'Order paid',
  'commerce.order.refunded': 'Order refunded',
  'commerce.order.cancelled': 'Order cancelled',
  'commerce.checkout.started': 'Checkout started',
  'commerce.cart.updated': 'Cart updated',
  'commerce.product.viewed': 'Product viewed',
  'commerce.customer.created': 'Customer created',

  'user.registered': 'Signed up',
  'user.login': 'Signed in',
  'user.logout': 'Signed out',
  'user.deleted': 'Account deleted',
  'user.invited': 'Invited a teammate',
  'user.subscription.started': 'Subscription started',
  'user.subscription.cancelled': 'Subscription cancelled',

  'cms.post.published': 'Post published',
  'cms.post.viewed': 'Post read',
  'cms.comment.created': 'Comment posted',
}

/**
 * A readable name for an event that has no documented label.
 *
 * `shop.basket.abandoned` becomes "Shop basket abandoned". Deliberately dull:
 * this is somebody else's vocabulary and the only safe thing to do with it is
 * make it legible, not interpret it.
 */
export function humanize(name: string): string {
  const words = String(name).replace(/[._-]+/g, ' ').trim()
  if (!words)
    return name

  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The label to show for an event name. */
export function eventLabel(name: string): string {
  return EVENT_LABELS[name] ?? humanize(name)
}

/**
 * Labels for the parts of a query, so the panel and the docs agree.
 *
 * "Unique users" rather than "count_unique": the panel is read by somebody
 * deciding what they want to see, not by somebody who has read the schema.
 */
export const MEASURE_LABELS: Record<string, string> = {
  count: 'Number of events',
  count_unique: 'Unique users',
  sum: 'Total of',
  avg: 'Average of',
  min: 'Smallest',
  max: 'Largest',
}

export const GRAIN_LABELS: Record<string, string> = {
  hour: 'Hourly',
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
}

export const OPERATOR_LABELS: Record<string, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  starts_with: 'starts with',
  gt: 'is greater than',
  lt: 'is less than',
  exists: 'is present',
  not_exists: 'is missing',
}

/** Labels for the fields a filter or dimension may name. */
export const FIELD_LABELS: Record<string, string> = {
  name: 'Event name',
  user_key: 'User',
  session_key: 'Session',
  value: 'Value',
  currency: 'Currency',
  occurred_at: 'Time',
}

/** The label for any field, including a `properties.` one. */
export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field])
    return FIELD_LABELS[field]!

  return field.startsWith('properties.') ? humanize(field.slice('properties.'.length)) : humanize(field)
}
