# Reporting concepts

ReportsHQ is an in-process reporting engine. It reads only the models, measures, time fields, dimensions and relations the application declares, compiles a bounded query, and returns one stable block shape to the included chart components or JSON API.

## Registry

The registry is the allowlist. A model description names the table and the fields that reporting may use. A database column that is not declared is not available to the builder or query compiler.

## Measure

A measure is a value to aggregate, such as revenue, orders or users. It defines the aggregate operation, optional source column and unit.

```ts
measures: {
  revenue: { aggregate: 'sum', column: 'total_amount', unit: 'currency' },
  orders: { aggregate: 'count' },
}
```

## Dimension

A dimension groups a measure, such as status, country or plan. Dimensions are bounded where necessary so a chart cannot accidentally request millions of categories. Values outside the displayed set are reported honestly as `Other` when the block supports it.

## Time grain

A time field can be bucketed by a supported grain such as day, week or month. Buckets are calculated in the report timezone, not by applying a fixed offset. This matters across daylight-saving changes and at both edges of a date range.

## Relation and fan-out

A relation explains how two declared models join. Mark a relation `fansOut` when one source row can match several target rows. ReportsHQ refuses measures that would be multiplied by that join.

For example, summing an order total while grouping through its line items counts the same order once per item. The compiler refuses that query. Declare line revenue on the line-item model instead.

## Block

A block is one report tile. Its kind controls presentation, while its query selects a model, measure, time field, dimension and filters. All block kinds receive the same result contract: series, totals and an optional error.

## Draft and published report

The builder edits the draft. Publishing creates the version shown by ordinary report views and share links. A half-finished layout therefore cannot leak through a public share merely because an editor moved a tile.

## Refusal

When a query cannot produce a defensible number, the block returns an explanation instead of a plausible guess. The rest of the report can still render. A refusal is part of the data contract, not a transport failure.
