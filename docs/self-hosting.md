# Self-hosting

There is no other kind, and that is the whole point.

The reporting engines run inside your application, on your servers, against
your database. Reporting sends no rows to ReportsHQ and the licence is checked
offline. The Laravel package also contains a separate, optional event
forwarder. That half sends events to an explicitly configured collector only
when its endpoint, key and sample rate enable it. The collector's future is an
unmade product decision, so do not assume it is either a required part of
reporting or permanently retired.

If you are looking for how to deploy `reportshq.org`, the marketing site and
account pages, that is [deploying](/docs/deploy) and it has nothing to do with
running reports.

## What you are actually running

Your application. The currently published package versions do not yet include
the reporting source described here. Check [release status](/docs/quickstart)
before installation.

```bash
composer require reportshq/laravel
php artisan migrate
```

After a reporting release exists, the Laravel package can load routes, views,
a console command and five tables. Routes and the JSON API remain off until
the host enables them. It does not add a service, daemon, queue worker of its
own, or port to open. Scheduled email uses the host's worker and scheduler.

## Requirements

PHP 8.2+, Laravel 11+, and a supported SQLite, MySQL or Postgres connection.
The current source has a query dialect for each of those three; do not assume
every database driver Laravel supports has one.

## Without a licence key

Leave `REPORTSHQ_LICENSE` unset and the current reporting engine still runs.
The plans in pricing copy do not gate functionality or guarantee that every
listed feature is implemented in both packages.

Nothing about the software changes. The pages say the installation is
unlicensed and that is the entire difference. This is deliberate: an offline
check cannot enforce a limit without the network call it refuses to make, and a
reporting tool that blanks a dashboard over a billing state is one nobody can
rely on for the dashboard.

If you are running this commercially, buy a licence because the work was worth
paying for, not because something will stop.

## The data never moves

Worth stating explicitly, because it is the property most self-hosting is
chasing.

Queries run in process on your own connection, not through ORM scopes. The
report engine has no ingest endpoint or vendor telemetry. The separate Laravel
event forwarder can POST taxonomy events to an endpoint the host explicitly
configures. The licence class opens no sockets.

For anyone under a data processing agreement, this is usually the shortest
section of a security review you will ever write.

## The share route is public by design

One route is deliberately unauthenticated: `/reports/shared/{token}`. That is
the point of a share link, and the token is the whole credential.

Two things follow. Put it behind whatever rate limiting your application already
applies to public routes, and treat a token in a log or an error report the way
you would treat a session cookie.

`reportshq.routes.share_middleware` controls what guards it. Adding an auth
guard there does not make it safer; it makes the link stop working for the people
it was sent to, and it fails silently because whoever sent it can still see the
report themselves.

## Backups

Your database backup already covers this. The reports live in five ordinary
tables beside everything else, so there is no separate thing to remember.

The only note worth making: a report is a definition, not a copy of the numbers.
Restoring the database restores the reports, and they recompute from whatever
data was restored with them.

## Upgrades

After a reporting release exists, `composer update reportshq/laravel`, then
`php artisan migrate`. Read the
changelog for anything with a `!` in the commit subject, which is how a breaking
change is marked.

The charts ship as a compiled bundle inside the package, so there is no asset
build on your side and nothing to rebuild after an upgrade.
