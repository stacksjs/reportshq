# Self-hosting

There is no other kind, and that is the whole point.

The package runs inside your application, on your servers, against your
database. Nothing is hosted on our side, nothing is sent anywhere, and the
licence is checked offline. What follows is therefore not a special deployment
mode: it is a description of what you already have once you install it.

If you are looking for how to deploy `reportshq.org`, the marketing site and
account pages, that is [deploying](/docs/deploy) and it has nothing to do with
running reports.

## What you are actually running

Your application. That is it.

```bash
composer require reportshq/laravel
php artisan migrate
```

The package adds routes, views, a console command and five tables. It does not
add a service, a daemon, a queue worker of its own, or a port to open. If your
application deploys, the reports deploy with it.

## Requirements

PHP 8.2+, Laravel 11+, and whatever database you already use. SQL is built for
whatever driver your connection reports, so anything Laravel supports works,
including SQLite.

## Without a licence key

Leave `REPORTSHQ_LICENSE` unset and every limit falls away. Unlimited
applications, unlimited reports, everything the Pro tier lists.

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

Queries run in process, through your own ORM, against your own connection. There
is no ingest endpoint, no export to a third party, and no telemetry. The licence
class opens no sockets, and a test asserts that by reading its source for
anything that could.

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

`composer update reportshq/laravel`, then `php artisan migrate`. Read the
changelog for anything with a `!` in the commit subject, which is how a breaking
change is marked.

The charts ship as a compiled bundle inside the package, so there is no asset
build on your side and nothing to rebuild after an upgrade.
