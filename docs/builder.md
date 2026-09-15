# Report builder

A report is a grid of blocks. The current source has two storage models: `@reportshq/stacks` asks the host for a `ReportStore`, while `reportshq/laravel` ships Eloquent report tables and a browser editor. The editor in this site's old hosted app was removed. Its read-only Accounts report is defined in `config/reportshq.ts`.

## Block kinds

Both current packages accept the same nine kind names in `packages/stacks/src/http/handlers.ts` and `packages/laravel/src/Reports/Block.php`:

| Kind | Use |
| --- | --- |
| `big_number` | A headline value |
| `line` | A time series |
| `area` | A filled time series |
| `bar` | Values over time or categories |
| `donut` | Category composition |
| `table` | Values in rows |
| `funnel` | A funnel chart frame |
| `heatmap` | A heatmap chart frame |
| `note` | Text without a query |

The current query engines do not have a separate ordered-step funnel calculation or two-dimensional heatmap aggregation. Do not infer those analytical semantics from the renderer kind alone.

## Query vocabulary

Each query-bearing block starts with `model` and `measure`, both looked up in the semantic registry. Measures are described with `count`, `sum`, `avg`, `min`, or `max`. Only `count` needs no column. The TypeScript block shape is `BlockQuery` in `packages/stacks/src/types.ts`:

```ts
{
  model: 'order',
  measure: 'revenue',
  time: { key: 'placed' },
  grain: 'day',
  from: '2026-08-01',
  to: '2026-09-01',
}
```

`dimension` groups by an allowlisted column. `time` selects an allowlisted date column on the measured model; `grain` can be `hour`, `day`, `week`, or `month`. `from` is inclusive and `to` is exclusive. A date range without `time` uses the model's first described time column. `limit` bounds a dimensioned result to at most 500 rows in the TypeScript compiler. The current TypeScript compiler accepts `=`, `!=`, `>`, `>=`, `<`, `<=`, and `like` for filters. Laravel's `Filter` uses the named operators `is`, `is_not`, `contains`, `starts_with`, `gt`, `lt`, `exists`, and `not_exists`. Do not copy a filter payload between the two runtimes without translating the operator vocabulary.

`compare` is present in the TypeScript type, but the current TypeScript compiler returns `comparison: null`. It does not yet compute a prior-period change. The retired event fields `events`, `user_key`, `session_key`, `properties.<key>`, and `steps` are not this reporting query schema.

The registry supplies every SQL identifier and the caller supplies only keys and parameterized values. A column not described in the registry is unreachable by a block request.

## Editing and publishing

A Stacks host can keep reports in code and make the viewer read-only. The browser builder is writable only when the store implements `addBlock`, `saveBlock`, `removeBlock`, and `publish`; a partially implemented editor is not advertised as writable. The host mounts the package's route descriptions and chooses auth and persistence. This site intentionally does not mount the builder.

In Laravel, `Builder` adds blocks, validates their kind, packs a 12-column layout on the server, and publishes a revision. The package's standalone editor is under `/reports/{slug}/edit` only after `routes.enabled` is set and the host chooses suitable middleware. The Filament plugin is another optional surface.

One impossible block returns its reason in `error` while the report can still render other blocks. A fan-out relation that would multiply a sum is refused instead of shown as a plausible wrong number. See [the query API](/docs/api) for the result shape.
