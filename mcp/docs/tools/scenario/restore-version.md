# scenario_restore_version — contract

Tool: `scenario_restore_version` (module `scenario`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view
and `format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments

- `scenario_id`: the scenario's id (uuid); default: the only scenario of the workspace (`ids.scenario_ids`), else `missing_argument`.
- `version`: integer 1 to 100000, required: the version to bring back.
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. `GET /projects/{id}/gatling/scenarios/{scenario_id}` once, before the write: the name and the current version (the way back).
2. `POST /projects/{id}/gatling/scenarios/{scenario_id}/versions/{version}/restore`: the version's artifact becomes the newest version and the
   self-check is cleared. A version the scenario does not have is a 404 (`not_found`); a version with no artifact snapshot is a 409; the tool decides
   neither.
3. Restoring the version that already is the current one writes nothing (`changed: false`, inert, no undo entry).

## format=data

`project_id`, `scenario` (`id`), `name` (masked), `version` (asked for), `new` (the version number the restore created; null when nothing was written),
`previous` (the version that was current), `changed`.
**Third party:** the scenario's name passes `content()`.

## Text view

```
checkout: v1 restored as v4 (v3 was the current one); the self-check is cleared.
```

Unchanged: `checkout (nothing restored): v3 is already the current version; nothing changed.` (the name carries the truth in the log entry too: its template says
`restored as v{new}`).

## Undo

`undo: {tool: "scenario_restore_version", args: {scenario_id, version: <the version that was current>}}`: the old content comes back as one more version
(the history keeps every version, so the artifact is as before while the version number is two higher). The self-check stays cleared (a restore clears it,
and so does the undo). A failed write leaves no entry with an undo.

## State

Reads `ids.project_id`, `ids.scenario_ids`. The self-check and the checks that depend on the scenario are reset by the reducer through the table of the
catalog (trigger `scenario_restore_version`: `scenario.self_check`, `scenario.composition_valid`, `scenario.compiled`, `scenario.drift`,
`data.bindings_set`, `data.datasets_ready`, `run.planned`); an unchanged call resets nothing.

## UI

Text only.

## Test cases

- Ordinary: restore version 1 of a scenario at 3; the artifact in the fake is the old one, version 4, self-check cleared; one read and one write.
- Undo: restore, take the undo from the log, call it; the artifact (self-check aside) is as before; the history holds 1, 2, 3, 4, 5.
- Invalidation: the seven checks of the table go to null after a change; none after an unchanged or a refused call.
- Edge: the current version (no write, no undo); unknown version (404); a version with no snapshot (409); unknown scenario; no `scenario_id` with one
  scenario or with several; version 0 and 100001; unknown argument; no bound project; Polish view; log entry.
- Adversary: sentinel in the scenario's name; instruction in the name; control sequences.

## Out of scope

Reading versions (`scenario_get_versions`), saving a scenario (`scenario_save`, deferred).
