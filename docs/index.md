---
layout: home
title: ReportsHQ Documentation
description: Reports that run inside your own Laravel application, against your own database. Installing the package, describing your models, the query API and the report builder.
hero:
  name: ReportsHQ
  text: Reports that build themselves
  tagline: "Describe the models you already have. The Commerce, Users and Content reports appear with real numbers in them, and nothing leaves your servers."
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: Ingestion API
      link: /quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/stacksjs/reportshq
features:
  - title: One package
    details: composer require, a migration, and a config file naming your models. Nothing to deploy beside it and no tracking calls to write.
  - title: Describe once, query safely
    details: Name your models, measures and dimensions in one config file. That description is an allowlist, so a block can only ever reach what you named.
  - title: It refuses rather than guesses
    details: Ask for a measure at a grain it does not have and the block says why, instead of returning a number that is quietly wrong.
  - title: Honest about its numbers
    details: No previous period is said rather than guessed at, bounded dimensions state what went into Other, and sampling keeps whole people.
  - title: Share without an account
    details: A link shows one published report and nothing else. Revoke it and it stops working on the next request.
  - title: It never sees your data
    details: Queries run in process through your own ORM. No connection to hand out, no endpoint to send to, and an offline licence check that opens no sockets.
---

## Start here

| You want to | Read |
|---|---|
| Get from nothing to a report | [Quickstart](/quickstart) |
| Install it into a Laravel application | [Laravel package](/laravel) |
| Read the JSON the charts consume | [Query API](/api) |
| Build a report of your own | [Report builder](/builder) |
| Send a report to somebody outside | [Sharing and embeds](/sharing) |
| Get the numbers as a file or an email | [Schedules and exports](/schedules-exports) |
| Know what a licence covers | [Limits](/limits) |
| Run it on your own machines | [Self-hosting](/self-hosting) |
