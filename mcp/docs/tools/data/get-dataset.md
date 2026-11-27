# data_get_dataset — contract

Tool: `data_get_dataset` (module `data`; level 1, class read+secret, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry before this tool).

## Arguments (exactly the catalog's)

- `dataset_id?`: UUID; default: the only dataset of `ids.dataset_ids` in the state. Several or none: `missing_argument`, no request.
- `include?`: at most 5 of `rows`, `consumers`, `history`, `snippet`, `redis`; none by default.
- `rows?`: 1–50, default 10; with `include: rows`, how many rows.
- `offset?`: 0–100000, default 0; with `include: rows`, the first row.

An unknown argument is refused (strict schema). The project is the one of the workspace.

## Operations

| part                 | request                                                             |
| -------------------- | ------------------------------------------------------------------- |
| the dataset (always) | `GET /projects/{project_id}/gatling/feeders/{feeder_id}`            |
| `rows`               | `GET …/feeders/{feeder_id}/preview?rows=&offset=`                   |
| `consumers`          | `GET …/feeders/{feeder_id}/used-in`                                 |
| `history`            | `GET …/feeders/{feeder_id}/audit`                                   |
| `redis`              | `GET …/feeders/{feeder_id}/redis/status`                            |
| `snippet`            | `POST …/feeders/preview-snippet` (built from the dataset just read) |

Without `include` exactly one request is sent. The dataset is read first, alone: the backend returns its whole content, and the
cells of its secret columns are registered as secrets of the call before anything else is read or shown. The other parts are read
together afterwards. A part whose request fails with an error of the backend is reported as unavailable and leaves the rest; a
failure of the dataset read ends the call.

## format=data

`project_id`, `dataset` (`id`, `name`, `file_name`, `type`, `strategy`, `consumption`, `row_count`, `columns[]` (`name`,
`semantics`: `secret` for credentials as in `data_list_datasets`; at most 30), `columns_total`, `recipe[]` (`column`,
`generator`; at most 30), `has_recipe`, `provenance`, `scenario_id`, `manually_edited`, `description`, `created_at`,
`updated_at`), `included` (the parts asked for) and one key per part: `preview` (`offset`, `total_rows`, `has_more`, `columns`
shown, `hidden_columns`, `cells`: one list of texts per row, aligned with `columns`; not named `rows`, which is the row count of the log), `consumers[]` (`kind`, `id`, `name`, `usage`,
`rows_note`, `slots`), `history` (`provenance`, `created_by`, `revisions[]` newest first, at most 20: `change_type`,
`created_at`, `created_by`), `snippet` (lines, at most 40), `redis` (`ok`, `remaining`, `latency_ms`, `detail`), each `null`
when not asked for and `{ "unavailable": true }` when its request failed.

**Secrets:** the content of the dataset is never copied. The cells of every secret column (credentials by meaning, or a name that
says so) are never shown: the column is listed under `hidden_columns` and its cells are registered as secrets. Other cells are
cut to 60 characters and masked like any text of a third party (`content()`); a connection setting (URL, user, password) of a
database or Redis dataset is never read. The audit metadata, with its sample rows, is not read.

## Text view

```
Dataset "accounts" [d6c0a4e8-…]: csv, 12 rows, exclusive, strategy queue; uploaded
columns: email (identity), password (secret), notes
rows 1-3 of 12 (hidden columns: password):
1. email=a1@example.test | notes=note one
```

## State

Reads `ids.project_id` and `ids.dataset_ids`; writes nothing. The log carries `{dataset_id} include={include}` and
`{name}: {rows} rows`.

## UI

Text only.

## Test cases

- Ordinary: the dataset alone (one request, no cell), each part (exact requests), rows with offset, data, Polish view, log.
- Edge: default id from the state, several or none in the state, unknown dataset (not_found), a part that fails with 500, a
  failing dataset read, a page past the last row.
- Adversary: sentinel in a password cell, in a cell of a plain column and in a 500 answer; an instruction in a cell stays one
  line; secret columns by name even when the backend calls them plain; argument outside the catalog refused.
