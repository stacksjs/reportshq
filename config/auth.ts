import type { AuthConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

/**
 * **Authentication Configuration**
 *
 * This configuration defines all of your authentication options. Because Stacks is fully-typed,
 * you may hover any of the options below and the definitions will be provided. In case
 * you have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
export default {
  enabled: true,

  /**
   * The authentication guard to use for your application.
   */
  default: 'api',

  /**
   * The authentication guards available for your application.
   */
  guards: {
    api: {
      driver: 'token',
      provider: 'users',
    },
  },

  /**
   * The authentication providers available for your application.
   */
  providers: {
    users: {
      driver: 'database',
      table: 'users',
    },
  },

  /**
   * The username field used for authentication.
   */
  username: env.AUTH_USERNAME_FIELD || 'email',

  /**
   * The password field used for authentication.
   */
  password: env.AUTH_PASSWORD_FIELD || 'password',

  /**
   * Access-token expiry in milliseconds (default: 7 days).
   *
   * This value IS the browser session length, not just an API-bearer TTL.
   * The auth actions mirror the issued access token into the HttpOnly
   * `auth-token` cookie (see app/Actions/Auth/authCookie.ts) because the
   * app is server-rendered stx with no client hydration and has no other
   * way to know who is asking. Both the cookie's Max-Age and the
   * `oauth_access_tokens.expires_at` row are stamped from the same number,
   * and nothing extends either one — `getUserFromToken` leaves `expires_at`
   * alone, then deletes the row once it passes. So a signed-in operator is
   * logged out exactly this long after login regardless of activity.
   *
   * This is the BASELINE only. LoginAction and VerifyTwoFactorLoginAction
   * pass a per-login `expiresInMinutes` from the sign-in form's "remember
   * me" checkbox (see sessionExpiryMinutes in app/Actions/Auth/authCookie.ts):
   * a week unchecked, 30 days checked. This default covers the entry points
   * that have no such checkbox — register above all — so they land on the
   * baseline week. It was 1h before (a sane API-bearer TTL but a hostile
   * session that forced a re-login mid-task every hour).
   */
  tokenExpiry: env.AUTH_TOKEN_EXPIRY || 7 * 24 * 60 * 60 * 1000,

  /**
   * Refresh-token expiry in milliseconds (default: 30 days).
   *
   * NOT WIRED UP. There is no refresh route, no RefreshTokenAction and no
   * cookie that stores a refresh token, so nothing ever reads this value —
   * it only bounds a row that never gets exchanged. Session length is
   * `tokenExpiry` above, alone. Building a refresh exchange is awkward here
   * anyway: an stx server block cannot set response headers, so a
   * server-rendered page has nowhere to rotate the cookie.
   */
  refreshTokenExpiry: env.AUTH_REFRESH_TOKEN_EXPIRY || 30 * 24 * 60 * 60 * 1000,

  /**
   * The token rotation time in hours (default: 24 hours).
   */
  tokenRotation: env.AUTH_TOKEN_ROTATION || 24,

  /**
   * The token abilities that are granted by default.
   */
  defaultAbilities: ['*'],

  /**
   * The token name used when creating new tokens.
   */
  defaultTokenName: 'auth-token',

  /**
   * Password reset configuration.
   */
  passwordReset: {
    /**
     * Token expiration time in minutes.
     * After this time, the reset link becomes invalid.
     *
     * @default 60
     */
    expire: env.AUTH_PASSWORD_RESET_EXPIRE || 60,

    /**
     * Where the emailed link points.
     *
     * Must match the page that exists, or the reset email sends people to a
     * 404 with a valid token in the URL - the worst version of this failure,
     * because it looks like the token is broken.
     */
    url: '/reset?token={token}&email={email}',

    /**
     * Throttle time in seconds between password reset requests.
     * Users must wait this long before requesting another reset email.
     *
     * @default 60
     */
    throttle: env.AUTH_PASSWORD_RESET_THROTTLE ||60,
  },
} satisfies AuthConfig
