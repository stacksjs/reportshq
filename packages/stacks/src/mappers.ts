/**
 * Stacks events, translated into the ReportsHQ taxonomy.
 *
 * A Stacks model with the `observe` trait emits `order:created`,
 * `user:created` and friends; the commerce and CMS modules dispatch their own.
 * None of those names mean anything to ReportsHQ, whose report templates are
 * written against the reserved names in `docs/events.md`. This file is the
 * whole of the translation, and it is a lookup table on purpose: a mapper that
 * inspects a payload and guesses at a name is a mapper that silently starts
 * producing a different report when somebody renames a model.
 *
 * **Extend `docs/events.md` before adding a name here.** The doc is what the
 * templates, the SDKs and the app's own validation are all written against, and
 * a name that exists in one of those and not the others is a report that is
 * quietly always empty.
 */
import type { TaxonomyEvent } from './transport'

/** The domains a mapping belongs to, so it can be switched off wholesale. */
export type Domain = 'commerce' | 'users' | 'cms'

export interface StacksEvent {
  /** The framework's event name, e.g. `order:created`. */
  name: string
  /** Whatever the emitter attached: usually the model's attributes. */
  payload?: Record<string, unknown>
}

interface Mapping {
  domain: Domain
  /** The reserved taxonomy name. */
  to: string
  /** Pull the numeric measure, when the event has one. */
  value?: (payload: Record<string, unknown>) => number | undefined
  /** Extra properties worth keeping, named as docs/events.md recommends. */
  properties?: (payload: Record<string, unknown>) => Record<string, unknown>
}

function num(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function str(value: unknown): string | undefined {
  if (value === null || value === undefined)
    return undefined
  const text = String(value).trim()
  return text.length > 0 ? text : undefined
}

/** Drop keys with nothing in them, so a payload is not mostly nulls. */
function compact(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && value !== null)
      out[key] = value
  }
  return out
}

/**
 * Every framework event this package understands.
 *
 * Both the `model:action` form the `observe` trait emits and the dotted form
 * the domain modules dispatch, because an application will emit whichever its
 * own code happens to use and neither is wrong.
 */
export const MAPPINGS: Record<string, Mapping> = {
  'order:created': {
    domain: 'commerce',
    to: 'commerce.order.created',
    value: payload => num(payload.total ?? payload.total_amount ?? payload.value),
    properties: payload => compact({
      order_id: str(payload.id ?? payload.uuid),
      items: num(payload.item_count ?? payload.items),
      status: str(payload.status),
    }),
  },
  'order:paid': {
    domain: 'commerce',
    to: 'commerce.order.paid',
    value: payload => num(payload.total ?? payload.total_amount ?? payload.value),
    properties: payload => compact({
      order_id: str(payload.id ?? payload.uuid),
      method: str(payload.payment_method ?? payload.method),
    }),
  },
  'order:refunded': {
    domain: 'commerce',
    to: 'commerce.order.refunded',
    value: payload => num(payload.refunded_amount ?? payload.total ?? payload.value),
    properties: payload => compact({
      order_id: str(payload.id ?? payload.uuid),
      reason: str(payload.reason),
    }),
  },
  'order:cancelled': {
    domain: 'commerce',
    to: 'commerce.order.cancelled',
    properties: payload => compact({ order_id: str(payload.id ?? payload.uuid) }),
  },
  'checkout:started': {
    domain: 'commerce',
    to: 'commerce.checkout.started',
    value: payload => num(payload.total ?? payload.value),
  },
  'cart:updated': {
    domain: 'commerce',
    to: 'commerce.cart.updated',
    properties: payload => compact({ items: num(payload.item_count ?? payload.items) }),
  },
  'product:viewed': {
    domain: 'commerce',
    to: 'commerce.product.viewed',
    properties: payload => compact({ sku: str(payload.sku ?? payload.id) }),
  },
  'customer:created': {
    domain: 'commerce',
    to: 'commerce.customer.created',
  },

  'user:created': {
    domain: 'users',
    to: 'user.registered',
    properties: payload => compact({
      plan: str(payload.plan),
      source: str(payload.source ?? payload.referrer),
    }),
  },
  'user:login': {
    domain: 'users',
    to: 'user.login',
  },
  'user:logout': {
    domain: 'users',
    to: 'user.logout',
  },
  'user:deleted': {
    domain: 'users',
    to: 'user.deleted',
  },
  'user:invited': {
    domain: 'users',
    to: 'user.invited',
    properties: payload => compact({ invited_by: str(payload.invited_by) }),
  },
  'subscription:created': {
    domain: 'users',
    to: 'user.subscription.started',
    value: payload => num(payload.amount ?? payload.price ?? payload.value),
    properties: payload => compact({
      plan: str(payload.plan ?? payload.plan_name),
      interval: str(payload.interval),
    }),
  },
  'subscription:cancelled': {
    domain: 'users',
    to: 'user.subscription.cancelled',
    properties: payload => compact({
      plan: str(payload.plan ?? payload.plan_name),
      reason: str(payload.reason),
    }),
  },

  'post:published': {
    domain: 'cms',
    to: 'cms.post.published',
    properties: payload => compact({
      post_id: str(payload.id ?? payload.uuid),
      author: str(payload.author ?? payload.author_id),
      category: str(payload.category),
    }),
  },
  'post:viewed': {
    domain: 'cms',
    to: 'cms.post.viewed',
    properties: payload => compact({ post_id: str(payload.id ?? payload.uuid) }),
  },
  'comment:created': {
    domain: 'cms',
    to: 'cms.comment.created',
    properties: payload => compact({ post_id: str(payload.post_id ?? payload.commentable_id) }),
  },
}

/**
 * The subject an event belongs to, for sampling and unique counts.
 *
 * A stable internal id, never an email or a name: it ends up in somebody else's
 * database and is only ever compared for equality, so anything more identifying
 * than an id is data nobody needed to hand over.
 */
function subjectOf(payload: Record<string, unknown>): { user_key?: string, session_key?: string } {
  return compact({
    user_key: str(payload.user_key ?? payload.user_id ?? payload.customer_id),
    session_key: str(payload.session_key ?? payload.session_id),
  })
}

/**
 * Translate one framework event, or return null if it is not one we map.
 *
 * Returning null rather than inventing a name is the point: an application
 * emits dozens of events that mean nothing to a reporting taxonomy, and
 * forwarding them under invented names would fill somebody's project with
 * vocabulary no template can read.
 */
export function mapEvent(
  event: StacksEvent,
  domains: Record<Domain, boolean>,
): TaxonomyEvent | null {
  const mapping = MAPPINGS[event.name]
  if (!mapping || !domains[mapping.domain])
    return null

  const payload = event.payload ?? {}
  const value = mapping.value?.(payload)
  const properties = mapping.properties?.(payload) ?? {}
  const subject = subjectOf(payload)

  // Assembled field by field rather than built as a bag and cast. The cast
  // compiled and was a lie: nothing checked that the object it produced still
  // had a name on it.
  const mapped: TaxonomyEvent = { name: mapping.to }

  if (value !== undefined) {
    mapped.value = value

    // Only where there is a value to denominate. A currency on a login is
    // noise that a filter will eventually be written against.
    const currency = str(payload.currency)?.toUpperCase()
    if (currency)
      mapped.currency = currency
  }

  if (subject.user_key)
    mapped.user_key = subject.user_key

  if (subject.session_key)
    mapped.session_key = subject.session_key

  if (Object.keys(properties).length > 0)
    mapped.properties = properties

  const occurredAt = str(payload.created_at ?? payload.occurred_at)
  if (occurredAt)
    mapped.occurred_at = occurredAt

  return mapped
}

/** The framework event names this package listens for. */
export function mappedEventNames(domains: Record<Domain, boolean>): string[] {
  return Object.entries(MAPPINGS)
    .filter(([, mapping]) => domains[mapping.domain])
    .map(([name]) => name)
}
