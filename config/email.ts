import type { EmailConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

export default {
  from: {
    name: env.MAIL_FROM_NAME || 'Reportshq',
    address: env.MAIL_FROM_ADDRESS || 'hello@example.com',
  },

  domain: env.MAIL_DOMAIN || env.APP_DOMAIN || 'example.com',
  mailboxes: [],
  forwards: {},
  url: env.APP_URL || 'reportshq.localhost',
  charset: 'UTF-8',

  server: {
    // Explicit opt-in: a generated application must never reconcile the
    // framework repository's shared mail server or mailboxes.
    enabled: false,
    scan: true,
    subdomain: 'mail',
  },
} satisfies EmailConfig
