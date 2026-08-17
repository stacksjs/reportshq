# What a licence covers

Priced per installed application. Not per event, and not per seat.

Per event is impossible by design now: your data never reaches us, so there is
nothing on our side to count, and metering your database from outside it would
mean this tool reporting on how much you sell. Per seat would need the package
to know who signs in to your application, which means reaching into your auth
and keeping a count of your staff. Per application is the one unit countable
from outside, obvious to a buyer, and it grows with an estate rather than with
a good quarter.

## The plans

| | Free | Hobby | Pro |
|---|---|---|---|
| Applications | 1 | 3 | 10 |
| Reports | Unlimited | Unlimited | Unlimited |
| People on the licence | 1 | 3 | 25 |
| Share links | Yes | Yes | Yes |
| Scheduled email | | Yes | Yes |
| XLSX export | | Yes | Yes |
| Embeds, unbranded shares | | | Yes |
| Priority support | | | Yes |

`app/Billing/limits.ts` is the only place these numbers live. The pricing page
renders from it rather than restating it, because a marketing table maintained
separately is a promise somebody eventually breaks by editing one of them.

## Reports are unlimited on every tier

Including free. A report runs inside your application, against your database,
on your machine. Charging by the report would be charging for something we do
not provide.

## Nothing here gates a report

This is the part worth reading twice. **An application over its allowance keeps
working.** Every number above describes what a licence covers, not what the
software will do.

Two reasons, and the second is the honest one.

A reporting tool that blanks a dashboard over a billing state is a tool nobody
can rely on for the dashboard. The moment it can go dark for a commercial
reason, every number it shows carries an asterisk.

And it could not enforce this anyway. The licence is checked offline and there
is no network call, deliberately: a package that phones home on boot has
quietly told its vendor which applications are running, how often they restart
and when they deploy. A licence check is not worth that. So the check verifies
the key's shape, says so on the page when it does not match, and stops there.

See `packages/laravel/src/License.php`. It opens no sockets, and a test asserts
that by reading the source for anything that could.

## What counts as an application

One installation: one codebase, one database, one licence key. A staging copy
of the same application does not count, and neither does a second environment.
Three products is three applications.

## Self-hosting

There is no other kind. The package runs on your servers either way, and a
licence is what you are buying rather than access to somewhere. Leave
`REPORTSHQ_LICENSE` unset and every limit above falls away; the pages say the
installation is unlicensed and nothing else changes.
