import { config } from '@stacksjs/config'
import { env } from '@stacksjs/env'

/**
 * Who this application is, on the public web.
 *
 * Absolute (scheme and host), because it goes into a link a terminal opens.
 * `APP_URL` carries that in production. Locally it can be a bare host, so it
 * is only trusted when it reads as a URL and otherwise falls back to the dev
 * server's own port.
 */
export function appOrigin(): string {
  const configured = String(config.app?.url ?? env.APP_URL ?? '').trim().replace(/\/+$/, '')
  if (/^https?:\/\//.test(configured))
    return configured
  if (configured && !configured.includes('localhost'))
    return `https://${configured}`
  return `http://localhost:${env.PORT ?? 3000}`
}

/** Read on every call: config overrides resolve after module load. */
function allowedHosts(): Set<string> {
  const hosts = new Set<string>()
  for (const configured of [env.APP_URL, env.APP_DOMAIN, appOrigin()]) {
    const raw = String(configured ?? '').trim()
    if (!raw)
      continue
    try {
      hosts.add(new URL(raw.includes('://') ? raw : `https://${raw}`).host)
    }
    catch {
      // Not a host. Nothing to allow.
    }
  }
  // `www.` beside the bare host: the redirect to the apex happens after the
  // browser has already chosen the Origin it sends.
  for (const host of [...hosts])
    hosts.add(host.startsWith('www.') ? host.slice(4) : `www.${host}`)
  return hosts
}

/**
 * Is this request's `Origin` one of ours?
 *
 * The guard for a cookie-authenticated JSON endpoint: a browser attaches
 * `Origin` to every cross-site POST, so refusing the ones that are not ours
 * stops a third-party page driving the endpoint with the visitor's session.
 * A request with no `Origin` passes, because that is what a server-to-server
 * call looks like, and the endpoint behind this still needs a session.
 *
 * Compared against configuration, not the `Host` header: behind the proxy the
 * app sees `Host: 127.0.0.1:<port>` while the browser sends the public origin,
 * so those two can never match in production.
 */
export function sameOrigin(request: { headers?: { get?: (name: string) => string | null } }): boolean {
  const origin = request.headers?.get?.('origin')
  if (!origin)
    return true
  try {
    return allowedHosts().has(new URL(origin).host)
  }
  catch {
    // A malformed Origin is not something a browser of ours sent.
    return false
  }
}
