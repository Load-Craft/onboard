# flows_duplicate — contract

Tool: `flows_duplicate` (module `flows`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view and
`format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes.

## Arguments

- `flow_ids`: the flows to copy, ids or names, comma-separated, 1 to 4000 characters; 1 to 20 of them, exactly one with `docs_id`.
- `docs_id`: uuid of a stored docs version: the one flow is copied onto it (the copy's steps are rebound to that version).
- `name`: the name of the copy, 1 to 200 characters; only with `docs_id` (a plain duplicate is named by the backend).
- Refused locally (`invalid_arguments`, no request): no flow or more than 20 or an empty entry (`flows_duplicate_count`); `docs_id` with
  several flows (`flows_duplicate_docs_one`); `name` without `docs_id` (`flows_duplicate_name_needs_docs`).
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. The flows are looked up by id or name (the list of flows).
2. Without `docs_id`: `POST /projects/{id}/flows/batch-duplicate` with `{flow_ids}`. Flows the backend could not copy come back as
   `failed_ids`; the others as the copies.
3. With `docs_id`: `POST /projects/{id}/flows/{flow_id}/duplicate-for-spec` with `{target_spec_id, new_name?}`. An unknown version is a 404; the
   backend's report says how many steps were rebound unchanged, changed, or not at all.

## format=data

`project_id`, `count` (copies made), `copies[]` (`id`, `name`, `version`; at most 50), `failed` (ids the backend could not copy), `report`
(with `docs_id` only: `source_version`, `target_version`, `steps`, `matched`, `changed`, `unmatched`; null otherwise).
**Third party:** names and docs versions pass `content()`.

## Text view

```
2 copies made: checkout (copy), browse (copy).
```

With `docs_id`: `1 copy made: checkout on docs v2.14.0 (steps: 6 matched, 1 changed, 0 not rebound).` Copies that failed: a line with their ids.

## Undo

The copies are new flows; the sources are not changed: `undo: {tool: "flows_delete", args: {kind: "flow", ids: [<the copies>]}}` (the tool names the way with `undo_tool` in `undo_args`) (level 3, a card
and the person's yes; the entry only names it). Nothing copied (all failed) or a call that failed leaves no entry with an undo.

## State

Reads `ids.project_id`, `ids.flow_ids`. Writes `ids.flow_ids`: the copies are added. No invalidation row names this tool.

## UI

Text only.

## Test cases

- Ordinary: duplicate one and two flows (ids, names); the copies are in the fake with the sources' blocks; `ids.flow_ids`; with `docs_id` the copy
  points at that docs version and the report is shown; a given name.
- Undo: duplicate, take the undo from the log, apply the deletion it names; the flows are as before; the sources were never changed.
- Edge: a flow the backend cannot copy (in `failed_ids`, the others copied; all failed: no undo); `docs_id` with two flows; `name` without
  `docs_id`; 21 flows; unknown docs version (404, nothing written, no undo entry); unknown flow name; no bound project; Polish view; log entry.
- Adversary: sentinel in names and versions; instruction in a name; control sequences.

## Out of scope

Moving flows to a docs version in place (`flows_migrate_docs`), deleting the copies (`flows_delete`).
