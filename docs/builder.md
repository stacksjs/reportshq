# Report builder

A report is a grid of blocks. Each block runs one query and draws one thing.

The terms here are the terms the interface uses, because both come from the
same validation schema in `app/Reports/schema.ts`. A test asserts this page
lists exactly the values that schema accepts, so a new measure cannot appear in
the product without appearing here.

## Blocks

| Kind | Draws |
|---|---|
| `line` | A measure over time |
| `area` | The same, filled, for one dominant series |
| `bar` | A measure across a dimension, or over coarse time |
| `donut` | Composition of a total across a dimension |
| `big_number` | One number, and whether it moved |
| `table` | The underlying rows, when the shape is not a chart |
| `funnel` | Conversion across ordered steps |
| `heatmap` | A measure across two dimensions |
| `text` | Prose. The only kind that runs no query |

## The query

Every block except `text` carries a query with these parts.

### events

The event names the block reads. Empty means every event in the project. Names
come from [the taxonomy](/docs/events) or are your own.

### measure

What to compute:

| Measure | Means |
|---|---|
| `count` | Rows. The default, and what a count of events means |
| `count_unique` | Distinct `user_key`. Unique visitors, active users, buyers |
| `sum` | Sum of the named field. Revenue, duration, quantity |
| `avg` | Mean of the named field. Order value, session length |
| `min` | Smallest value of the named field |
| `max` | Largest value of the named field |

`sum`, `avg`, `min` and `max` require a **field**. `count` and `count_unique`
ignore one.

### field

Which value the measure reads. One of `name`, `user_key`, `session_key`,
`value`, `currency`, `occurred_at`, or `properties.<key>` for anything in your
own property bag.

This is an allowlist rather than a pattern. These names reach a query builder,
and "anything that looks like an identifier" is how a column name becomes an
injection point the day somebody builds the query with a template string.

### dimension

Group the result into series by a field, using the same set as above. Bounded
by **limit** with an explicit other bucket: when two hundred tags become the top
ten, the report says how many went into Other rather than letting a reader
assume the tail does not exist.

### filters

Narrow what the block counts. Each filter is a field, an operator and usually a
value:

| Operator | Means |
|---|---|
| `is` | Equal to |
| `is_not` | Not equal to |
| `contains` | Substring |
| `starts_with` | Prefix |
| `gt` | Greater than |
| `lt` | Less than |
| `exists` | The field is present |
| `not_exists` | The field is absent |

`exists` and `not_exists` carry no value, because the test is presence.

### grain

How time is bucketed: `hour`, `day`, `week` or `month`.

### compare

Compare against the previous period of equal length. When there was no previous
period, the block says so rather than inventing a percentage. This is how
dashboards end up claiming a four thousand percent rise, and it is always
because the previous period was zero.

### limit

Top N series when a dimension is set. The rest become Other, and the count is
stated.

### steps

Ordered event names, for `funnel` blocks only. A funnel measures people, not
events, so when data is sampled the sampling keeps whole subjects: somebody is
either wholly in the sample or wholly out. Sampling events independently makes
every conversion rate noise, because the steps stop belonging to the same
people.

## The grid

Twelve columns. Drag a block to move it, its corner to resize, and everything
has a keyboard path. Blocks push each other out of the way while you hold one,
and the server settles the layout before saving, so two blocks can never share
a cell. That last part is on the server deliberately: a layout agreed by one
browser is a layout that disagrees with itself when two people edit at once.

## Draft and published

Edits go to a draft. The published version is what a teammate opens and what a
[share link](/docs/sharing) serves, and it does not change until you publish. A
half finished experiment is never what somebody else walks into.

## Every block explains itself

Each block carries one sentence derived from the query it actually runs, not
from a label somebody typed. Two charts both called Revenue can count different
things, and a reader deserves to know which one is in front of them before they
quote a number in a meeting.

## Report filters

A whole report can be narrowed from its URL:

```
/reports/my-report?f=properties.plan:is:pro
```

The form is `f=field:operator:value`, repeated, up to five. It lives in the
query string and nowhere else, so a narrowed view is linkable: paste the URL
into a conversation and the reader sees what you saw.

Operators here are limited to `is`, `is_not` and `contains`. A malformed filter
is dropped rather than erroring, so a link with one bad filter still shows the
report. Funnels are left alone, because quietly narrowing their steps would
change what the conversion rate measures without saying so.
