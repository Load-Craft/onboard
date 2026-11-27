# traffic_get_snapshot — contract

Tool: `traffic_get_snapshot` (module `traffic`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (catalog 1457de88).

## Arguments (exactly the catalog's)

- `snapshot_id?`: UUID; default `choices.run.traffic_snapshot_id` of the workspace, else `missing_argument` (no request), whose hint sends to `traffic_list_snapshots` (an empty list: none pushed yet).
- `series?`: `summary` (default) | `points`. Summary: per route the number of points, min, max and sum. Points: up to 20 routes
  (by sum) of up to 60 points each (in data; the view shows the first 12 of a route).

The project is the bound one. An unknown argument is refused.

## Operations

`GET /projects/{id}/production-traffic/snapshots/{snapshot_id}`, once. 404 is `not_found`.

## format=data

`snapshot_id`, `name` (the window as text, the log slot `{name}`), `quality` (`complete` | `gaps` | `unusable`, the log slot
`{quality}`), `created_at`, `channel`, `token_label`, `window_start`, `window_end`, `bucket_seconds`, `unit`, `timezone`,
`entry_route`, `source` (`kind`, `query`, at most 300 characters), `counts` (`buckets`, `gaps`, `partials`, `resets`, `unusable`,
`rows`, `routes`, `total_count`), `gaps` and `unusable` (each `count` and `items[]` at most 10 of `{start, end}`),
`excluded_windows` (`count`, `items[]` at most 10 of `{start, end, reason}`), `session_profile` (null, or `navigation_signal`,
`route_keys`, `transition_cells`, `next_cells`, `suppressed_transition_cells`, `suppressed_next_cells`), `series_mode`,
`routes` (`count`, `items[]` at most 50 in summary, 20 in points: `route` (null: the route-less series), `points`, `min`,
`max`, `sum`, `gap_points`; in points mode also `values[]` of `{at, count, quality}` at most 60).

**Third party:** routes, the entry route, the source's kind and query, reasons, labels and the timezone come from the sender:
each passes `content()` (mask by shape, secrets registered, one line). Counts and moments are numbers and ISO stamps.

## Text view

```
Snapshot 2026-11-26 00:00 – 2026-11-27 00:00 UTC, pushed by nightly-sender
id 0d0c7034-0006-4000-8000-000000000001
counts requests per 1 h (Europe/Warsaw): 2 routes, 48 rows, 12,400 in total; entry route GET /
source: prometheus — sum by (route) (rate(http_requests_total[1h]))
quality: 24 buckets, 1 gap, 0 unusable
gaps (1): 2026-11-26 03:00–04:00 UTC
routes (2, by total):
  GET / — 2 points, min 300, max 500, total 800
  POST /cart — 1 point, min 40, max 40, total 40
```

Points: each route line ends with `: 11-26 00:00 300, 11-26 01:00 500` (a gap `—`), the first 12, then `(+N more)`.

## State

Reads `ids.project_id` and `choices.run.traffic_snapshot_id`; writes nothing but the log entry.

## UI

Text only.

## Test cases

- Ordinary: summary, `format: "data"`, points, the Polish view, the log entry, one request, the default from the state.
- Edge: no snapshot id and none chosen (`missing_argument`, no request), 404, a gap point (`null` count), 60 routes (50 shown),
  a session profile, unusable intervals and excluded windows.
- Adversary: sentinel in a route, the source query, a reason and the label; an instruction with a line break in a route; a
  `snapshot_id` that is no UUID and an unknown argument refused with no request.
