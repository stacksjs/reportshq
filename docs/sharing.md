# Sharing and embeds

A share link shows one published report and nothing around it: no navigation
into the rest of your project, no sign-in wall, no account for the recipient to
create. The people who most need to see a number are usually the least willing
to make a login for it.

## Creating a link

From a report, create a share. You get a URL of the form:

```
https://reportshq.org/s/<token>
```

The token is the credential. Anyone holding it sees that one report, as
published. They cannot reach anything else in the project, and the link grants
no ability to change anything.

## Revoking and rotating

**Revoke** and the link stops working on the next request, not at the end of a
cache window.

**Rotate** and the same report becomes available at a new token while the old
one dies. That is the honest fix when a URL has been forwarded further than you
meant: the people who should still have it get the new link, and everyone else
is simply out.

## Views are recorded

Each view is recorded against the link, so you know whether the weekly report
somebody asked for is actually being opened. It settles a lot of arguments
about what is worth continuing to produce.

## Embedding

The same report can be embedded in a page of your own:

```html
<iframe
  src="https://reportshq.org/embed/<token>"
  width="100%"
  height="480"
  style="border: 0"
  title="Revenue per day"
></iframe>
```

A client portal or an internal wiki then carries the live chart rather than a
screenshot somebody took in March.

Embedding is available on the paid tiers, and the top tier removes our footer
from shared and embedded reports so what you send a client looks like your work.
See [limits](/docs/limits) for which tier carries what.

## What a share is not

A share link is shared with whoever holds it. It is not a login, there is no
per-recipient identity behind it, and it should not be treated as private
beyond the secrecy of the URL. `robots.txt` keeps `/s/` and `/embed` out of
search indexes, but a link pasted into a public page is public.

If a report should only be seen by named people, add them to the project as
members instead.
