import type { EmailConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

/**
 * Mail for ReportsHQ.
 *
 * Delivered by our own Zig mail server, which already runs on the shared box
 * and serves the other domains alongside this one. Nothing here talks to SES,
 * SendGrid or any third party: `buddy deploy` reconciles this file onto that
 * server (domain, DKIM key, mailboxes, forwards) and writes the matching MX,
 * SPF, DKIM and DMARC records, so a deploy is the whole of the mail setup.
 *
 * The product only sends a handful of things - a password reset, a quota
 * warning, a scheduled report - but every one of them is a message somebody is
 * waiting for, so they go out authenticated from a domain that can prove it
 * sent them rather than from whatever the box's hostname happens to be.
 */
export default {
  from: {
    name: env.MAIL_FROM_NAME || 'ReportsHQ',
    // Transactional mail comes from an address nobody is expected to reply to,
    // and replies to it are forwarded rather than dropped. See `forwards`.
    address: env.MAIL_FROM_ADDRESS || `no-reply@${env.MAIL_DOMAIN || 'reportshq.org'}`,
  },

  domain: env.MAIL_DOMAIN || 'reportshq.org',

  /**
   * The mailboxes on the shared server, reconciled by `buddy mail:provision`,
   * which `buddy deploy` also runs.
   *
   * Two, deliberately. `hello@` is the address the site prints and a person
   * reads; `no-reply@` is what the application sends as, and exists as a real
   * mailbox rather than a bare From header so that bounces and out-of-office
   * replies land somewhere instead of being rejected by the receiving side.
   *
   * **Each needs a `MAIL_PASSWORD_<LOCALPART>` in the target environment**, or
   * it is skipped. That is deliberate upstream - a deploy must not conjure
   * credentials nobody can retrieve - but it used to be silent, so a mailbox
   * declared here simply never appeared. `MAIL_PASSWORD_HELLO` and
   * `MAIL_PASSWORD_NO_REPLY` are what these two read.
   */
  mailboxes: [
    'hello',
    'no-reply',
  ],

  /**
   * Aliases: mail delivered to the key is written to the addresses in the
   * value. Re-read on every message, so a change takes effect on the next
   * provision without a restart.
   *
   * **Only full-address keys, deliberately.** The bare local-part form is not
   * domain-scoped, and this mail server hosts a dozen domains: a bare `support`
   * key catches support@ for every tenant that has no real mailbox at that
   * address. Declaring `support@reportshq.org` and `billing@reportshq.org`
   * here produced exactly that, and the mail of five other domains would have
   * been forwarded into this project's inbox.
   *
   * The consequence is that an alias only works for an address that is also a
   * registered mailbox, since that is when the server looks a forward up by
   * full address. So support@ and billing@ are not offered at all rather than
   * offered unsafely; hello@ is the published address, and either can become a
   * real mailbox later if it earns one.
   */
  forwards: {
    // Replies to transactional mail. Somebody answering a quota warning is
    // trying to reach a person, and no-reply@ is a convention rather than an
    // instruction they are obliged to follow. Safe as a full-address key
    // because no-reply@ is a real mailbox on this domain.
    'no-reply@reportshq.org': ['hello@reportshq.org'],
  },

  url: env.APP_URL || 'https://reportshq.org',
  charset: 'UTF-8',

  server: {
    // Explicitly on: this app has mail intent, so `buddy deploy` reconciles it
    // onto the shared server. An app that leaves this false is skipped
    // entirely, which is what stops a generated app touching shared mail.
    enabled: true,
    scan: true,
    subdomain: 'mail',

    // The full Zig server, which is what the box already runs. The serverless
    // mode would stand up a second, different thing beside it.
    mode: (env.MAIL_SERVER_MODE || 'server') as 'serverless' | 'server',

    storage: {
      // Long enough that a bounce investigated a month later still has the
      // message behind it; short enough that a mailbox nobody reads does not
      // grow forever.
      retentionDays: 90,
      archiveAfterDays: 30,
    },

    ports: {
      smtp: 25,
      smtps: 465,
      submission: 587,
      imap: 143,
      imaps: 993,
      pop3: 110,
      pop3s: 995,
    },

    features: {
      imap: true,
      pop3: false,
      webmail: false,
      calDAV: false,
      cardDAV: false,
      activeSync: false,
    },
  },

  notifications: {
    newEmail: false,
    // The two worth knowing about: a bounce means somebody did not get a
    // password reset, and a complaint means we are close to being treated as a
    // spammer by a provider that will not tell us twice.
    bounces: true,
    complaints: true,
  },

  /**
   * The driver.
   *
   * `smtp` in production, pointed at our own server over the submission port.
   * Locally it falls back to `log`, so a development machine writes mail to the
   * log instead of sending it - a password reset fired by a test must not reach
   * a real inbox.
   */
  default: (env.MAIL_MAILER || env.MAIL_DRIVER || 'log') as 'ses' | 'sendgrid' | 'mailgun' | 'mailtrap' | 'smtp' | 'log' | 'capture',
} satisfies EmailConfig
