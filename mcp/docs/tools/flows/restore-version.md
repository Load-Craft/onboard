# flows_restore_version — contract

Tool: `flows_restore_version` (module `flows`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view
and `format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments

- `flow_id`: the flow, its id or name, 1 to 200 characters; default: the only flow of the workspace (`ids.flow_ids`), else `missing_argument`.
- `version`: integer 1 to 100000, required: the version to bring back.
- `reason`: text, at most 200 characters, optional: why (the backend keeps it as the change reason of the new version).
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. The flow is looked up by id or name (the list of flows when a name is given), then `GET /projects/{id}/flows/{flow_id}` once, before the
   write: its name and its current version (the way back).
2. `POST /projects/{id}/flows/{flow_id}/versions/restore` with `{version, change_reason}`. A version the flow does not have is a 404
   (`not_found`); the tool does not decide it. The restored version becomes the newest one (a new version number), nothing is deleted.
3. Restoring the version that already is the current one writes nothing (`changed: false`, inert, no undo entry).

## format=data

`project_id`, `flow` (`id`), `name` (the flow's name, masked), `version` (the version asked for), `new` (the version number the restore created;
null when nothing was written), `warnings` (what the restore could not bring back: `code`, the `endpoints` it names), `previous` (the version that was current), `changed`.
**Third party:** the flow's name passes `content()`.

The log entry of an unchanged call says `zakupy (nothing restored): v3 restored as v3`: its template names `{new}`, no version was made, so the name says what
happened (the data carries the same name) and `{new}` keeps the current number.

## Text view

```
Checkout: v1 restored as v4 (v3 was the current one).
```

A warning of the backend (endpoints that are no longer source endpoints, a docs version that is gone or mixed) follows as one line each.

Unchanged: `Checkout: v3 is already the current version; nothing changed.`

## Undo

`undo: {tool: "flows_restore_version", args: {flow_id, version: <the version that was current>}}`: it brings the old content back as one more
version; the history keeps every version, so the flow's content is as before while its version number is two higher. A write that fails
(unknown version, unknown flow) leaves no entry with an undo.

## State

Reads `ids.project_id`, `ids.flow_ids`. Writes `steps.flows.flows_built` (the flow is built: `ok: true`). The warning `flows_need_input` follows the
restored flow (as `flows_get` does). No invalidation row names this tool.

## UI

Text only.

## Test cases

- Ordinary: restore version 1 of a flow that is at 3; the flow in the fake has the old blocks and the new current version; one read and one
  write; the state check.
- Undo: restore, take the undo from the log, call it; the flow's blocks, edges, entry block and variables are as before (the version number is
  not compared: restore creates versions).
- Edge: the current version (no write, no undo); unknown version (404, flow unchanged, no undo entry); unknown flow; the flow by name; no
  `flow_id` with one flow or with several; version 0 and 100001 and a reason of 201 characters refused; unknown argument refused; no bound
  project; Polish view; log entry.
- Adversary: sentinel in the flow's name; instruction in the name; control sequences.

## Out of scope

Reading versions (`flows_get_versions`), saving a flow (`flows_save`).
