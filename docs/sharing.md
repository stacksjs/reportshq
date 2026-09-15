# Sharing

The current Laravel source can serve one published report through a revocable
token, without a recipient account. The current Stacks package has no share
route in `reportRoutes`, and reportshq.org does not mount one. These instructions
apply to a Laravel host after a reporting release containing this source exists.

## Creating a link

From a report, create a share. You get a URL of the form:

```
https://your-app.example.com/reports/shared/<token>
```

The link is served by your own application, on your own domain - the route is
`/reports/shared/{token}`, mounted alongside the rest of the package. Nothing
is hosted here.

The token is the credential. Anyone holding it sees that one report, as
published. They cannot reach other reports through this route, and the link grants
no ability to change anything.

## Revoking and rotating

**Revoke** and the link stops working on the next request, not at the end of a
cache window.

There is no dedicated rotate operation in the current API. Revoke the old share
and create a new one, then distribute the new URL. The API list reveals only a
token hint, not the complete token.

## Views are recorded

Each view is recorded against the link, so you know whether the weekly report
somebody asked for is actually being opened. It settles a lot of arguments
about what is worth continuing to produce.

The current reporting package has no embed route or tier-based share guard.
Pricing copy is not an inventory of shipped link features. See [limits](/docs/limits)
for how the offline licence behaves.

## What a share is not

A share link is shared with whoever holds it. It is not a login, there is no
per-recipient identity behind it, and it should not be treated as private
beyond the secrecy of the URL. The host application is responsible for cache,
logging and crawler policy for `/reports/shared/{token}`. A link pasted into a
public page is public.

If a report should be seen only by named people, protect a normal report route
with the host application's authorization policy instead.
