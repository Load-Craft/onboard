# traffic_list_snapshots — contract

Tool: `traffic_list_snapshots` (module `traffic`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (catalog 1457de88).

## Arguments (exactly the catalog's)

- `include?`: `["format_sample"]` (at most one). Adds the packet format by example: field names and types, no values.
- `limit?`: integer 1–100, default 20. The API answers every snapshot; the tool keeps the first `limit` (newest first).

The project is the bound one (`projectIdOf`, else `no_project`). An unknown argument is refused.

## Operations

| read                       | request                                                     |
| -------------------------- | ----------------------------------------------------------- |
| list                       | `GET /projects/{id}/production-traffic/snapshots`           |
| + `include: format_sample` | `GET /projects/{id}/production-traffic/samples` (auxiliary) |

Both at once. The sample is auxiliary: an API error there leaves the list and marks `format_state: "unavailable"`.

## format=data

`project_id`, `count` (every snapshot the project holds; the log slot `{count}`), `shown`, `snapshots[]`: `id`, `created_at`,
`channel` (`push` | `file`), `token_label` (null for a file), `window_start`, `window_end`, `bucket_seconds`, `unit`
(`requests` | `sessions`), `timezone`, `routes`, `rows`, `total_count`, `source_kind`, `quality` (`buckets`, `gaps`,
`partials`, `resets`, `unusable`, `session_profile` — whether the packet held one). `limits`
(`snapshots_kept_per_sender`, `max_window_days`). `format_state` (`none` | `read` | `unavailable`), `format_sample` (null, or
`schema_title`, `fields[]` of `{path, type}` at most 40, `csv_columns[]` at most 20).

The source's query, the entry route, the packet id and the checksum are not read into the data: the query is the sender's text
(it can hold a credential of a metrics store) and the others say nothing the list needs; `traffic_get_snapshot` shows one.

**Third party:** token labels, timezones, source kinds and the field names of the sample pass `content()`. No value of the
sample is read: only the names of its fields, their JSON types and the header of the CSV.

## Text view

```
Traffic snapshots (2, newest first):
1. 2026-11-26 00:00 – 2026-11-27 00:00 UTC, pushed by nightly-sender: requests per 1 h, 2 routes, 48 rows, 12,400 in total
   id 0d0c7034-0006-4000-8000-000000000001; quality: 24 buckets, 1 gap, 0 unusable
2. …
limits: up to 14 snapshots kept per sender, a window up to 31 days
```

With the sample: `packet format (TrafficPacketV1):`, `  fields: version (number), window.start (string), …`,
`  CSV columns: bucket_start, route, count`. None: `No traffic snapshots yet; traffic_get_push_setup shows how a sender
pushes one.` More than `limit`: `showing the first 20 of 25`.

## State

Reads `ids.project_id`; writes nothing but the log entry (`{count} snapshots`).

## UI

Text only: a short list a person reads to pick a snapshot for `traffic_get_snapshot`.

## Test cases

- Ordinary: two snapshots (push and file), `format: "data"`, the Polish view, the log entry, one request.
- Edge: no snapshot, `limit` 1 of 3, a session profile, `include: ["format_sample"]` (two requests, fields and CSV columns),
  the sample failing with 500 (list still shown), 404 of the project.
- Adversary: sentinel in a token label, the source's query and a field name of the sample; a value of the sample never shown;
  `limit` 0 and 101 and an unknown `include` refused with no request; level 1, so it is offered.
