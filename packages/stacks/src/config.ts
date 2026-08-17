import type { ModelDescription } from './types'

/**
 * What an application hands the package.
 *
 * Everything is optional except the descriptions, because everything else has
 * a defensible default and a reporting package should not need a page of
 * configuration before it shows a number.
 */
export interface ReportsHQConfig {
  /** The models this application will report on. The allowlist. */
  models: Record<string, ModelDescription>

  /**
   * The licence key, checked offline and never sent anywhere.
   *
   * Nothing here gates a report. An application over its allowance keeps
   * reporting on its own data exactly as before; the pages simply say they are
   * unlicensed.
   */
  license?: string | null

  /** The zone buckets are computed in. The application's own, unless told otherwise. */
  timezone?: string

  routes?: {
    enabled?: boolean
    prefix?: string
    middleware?: string[]
    /**
     * A share link is read by somebody with no account, so it deliberately does
     * not inherit the middleware above. Do not add a guard here unless you mean
     * the link to stop working for the people it was sent to.
     */
    shareMiddleware?: string[]
  }

  api?: {
    enabled?: boolean
    prefix?: string
    middleware?: string[]
  }
}

export const defaults: Required<Pick<ReportsHQConfig, 'timezone'>> & {
  routes: Required<NonNullable<ReportsHQConfig['routes']>>
  api: Required<NonNullable<ReportsHQConfig['api']>>
} = {
  timezone: 'UTC',
  routes: {
    enabled: true,
    prefix: '/reports',
    middleware: ['auth'],
    shareMiddleware: [],
  },
  api: {
    // Off unless asked for. A JSON surface is a decision, not a default, and an
    // application that only wants the pages should not have to turn one off.
    enabled: false,
    prefix: '/api/reportshq',
    middleware: ['auth'],
  },
}

export function resolveConfig(config: ReportsHQConfig): Required<ReportsHQConfig> {
  return {
    models: config.models,
    license: config.license ?? null,
    timezone: config.timezone ?? defaults.timezone,
    routes: { ...defaults.routes, ...config.routes },
    api: { ...defaults.api, ...config.api },
  }
}
