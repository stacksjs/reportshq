---
layout: home
title: ReportsHQ Documentation
description: In-process reporting source for Stacks and Laravel. Release status, model allowlists, query APIs, and builder behavior.
hero:
  name: ReportsHQ
  text: Reports inside your application
  tagline: "Describe the models and columns reporting may read, then define a report against your own database. Check release status before installing."
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: Stacks package
      link: /stacks
    - theme: alt
      text: View on GitHub
      link: https://github.com/stacksjs/reportshq
features:
  - title: Two in-process packages
    details: The current Stacks and Laravel source query the host application's database. Their reporting rewrites are not yet in the published package versions.
  - title: Describe once, query safely
    details: Name your models, measures and dimensions in one config file. That description is an allowlist, so a block can only ever reach what you named.
  - title: It refuses rather than guesses
    details: Ask for a measure at a grain it does not have and the block says why, instead of returning a number that is quietly wrong.
  - title: Honest about refusals
    details: A block reports why it could not run instead of presenting a plausible wrong number. The current TypeScript compiler does not calculate prior-period comparison.
  - title: Laravel sharing
    details: The current Laravel source has revocable links for one published report. The Stacks package does not yet describe a share route.
  - title: It never sees your data
    details: Reporting queries run in process on the application's own connection, not through ORM scopes. The Laravel event forwarder is separate and optional.
---

## Start here

| You want to | Read |
|---|---|
| Check release status and preview the current source | [Quickstart](/quickstart) |
| Understand measures, dimensions and refusals | [Reporting concepts](/concepts) |
| Integrate the Stacks source after release | [Stacks package](/stacks) |
| Integrate the Laravel source after release | [Laravel package](/laravel) |
| Review every integration setting | [Configuration](/configuration) |
| Read the JSON the charts consume | [Query API](/api) |
| Build a report of your own | [Report builder](/builder) |
| Send a report to somebody outside | [Sharing](/sharing) |
| Get the numbers as a file or an email | [Schedules and exports](/schedules-exports) |
| Know what a licence covers | [Limits](/limits) |
| Run it on your own machines | [Self-hosting](/self-hosting) |
| Diagnose a report or deployment | [Troubleshooting](/troubleshooting) |
