# data_list_datasets — contract

Tool: `data_list_datasets` (module `data`; level 1, class read+secret, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. The catalog names no argument for it, so the tool takes none but `format`.

## Arguments

None. The project is the one of the workspace (`projectIdOf`). An unknown argument is refused (strict schema).

## Operations

`GET /projects/{project_id}/gatling/feeders` — one request. The answer is the summary of each dataset: the metadata, never its
cells (no `content`, no sample rows of the audit). The tool reads no other field and shows the count the backend reports.

## format=data

`project_id`, `count` (the datasets of the project, as the backend counts them), `shown` (at most 50), `datasets[]`: `id`,
`name`, `file_name`, `type` (`csv`, `tsv`, `ssv`, `json`, `jdbc`, `redis`, `custom`), `strategy`, `consumption` (`shared` or
`exclusive`), `rows`, `columns[]` (`name`, `semantics`: `identity`, `secret`, `entity-ref`, `synthetic`, `derived` or null;
at most 30; the backend's `credential` is reported as `secret`, because the scope of the call has registered that word as a secret), `columns_total`, `has_recipe`, `provenance` (`uploaded`, `auto`, `auto-edited`), `scenario_id` (the scenario a
generated dataset was made for, or null), `manually_edited`, `updated_at`.

**Secrets and third party:** no cell, no connection setting and no password is read, so none can be shown. Every name (dataset,
file, column) passes `content()`. A column of credentials is named and marked `secret`, never shown with a value.

## Text view

```
2 datasets:
1. "accounts" [d6c0a4e8-1b57-4f32-a9c8-7e2f5d1b3a09]
   csv, 2000 rows, exclusive, strategy queue; uploaded; columns: email (identity), password (secret)
2. "search phrases" [8b4e2c70-5f1a-4d93-9e06-a1c7d3f8b254]
   csv, 500 rows, shared, strategy random; generated for scenario 5d3a…; columns: q
```

Zero datasets: one sentence. A cut list ends with `showing the first N of M datasets`; a cut column list with `+N more`.

## State

Reads `ids.project_id` (through the workspace binding); writes nothing. The log carries the result `{count} datasets`.

## UI

Text only: the list is for the model that picks a dataset; the mod shows the process, not this list.

## Test cases

- Ordinary: list of three, columns with their semantics, `format: "data"`, Polish view, log entry, one request.
- Edge: no datasets, a project the backend does not know (not_found), no bound workspace (no_project), more datasets than the
  view shows, more columns than shown, names with control sequences and line breaks.
- Adversary: sentinel in a dataset name, a file name, a column name (tainted answer) and in a 500 answer; no cell and no
  `content` of the dataset in view or data even when the answer carries them; an instruction in a name stays one line of text;
  an argument outside the catalog refused.

## Out of scope

One dataset in detail (`data_get_dataset`).
