# scenario_save — contract

Tool: `scenario_save` (module `scenario`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view and `format: "data"`;
description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`). Matches the catalog: yes.

## Arguments (the catalog's)

- `scenario_id?`: string 1–200, id or name, no default from the state; without it a new empty scenario is created.
- `name?`: string 1–200; required for a new scenario.
- `tags?`: text, comma-separated, up to 1000 characters and 20 tags; replaces the list, an empty text clears it.
- `is_active?`: boolean; only for an existing scenario.
- `slo_thresholds?`: object, key to number; `{}` is the standard SLO; the backend checks the keys and ranges (a 422 is the backend's text, nothing written).
- `slo_from_project?`: boolean; `true` drops the scenario's own thresholds (it inherits the project's); with `slo_thresholds` it is refused.
- Refused locally with `scenario_save_refused` and no request: nothing to change for an existing scenario, `slo_thresholds` with `slo_from_project: true`,
  more than 20 tags, `is_active` or `slo_from_project: true` without `scenario_id`. A creation without `name` is `missing_argument`.

## Operations

- Existing scenario: the scenario is looked up by id or name, then `GET …/gatling/scenarios/{id}` once (name, tags, active flag, thresholds: the way back),
  then `PUT …/gatling/scenarios/{id}` with only the fields that differ. Values the scenario already has send nothing (`inert`, no undo entry).
- New scenario: `POST …/gatling/scenarios` with `name`, a class name made from it (ASCII words in capitals; the backend requires one), tags and thresholds when given.

## Undo

- A change: `scenario_save` with the previous values of the changed fields (`undo_args`): name, tags as a comma text, `is_active`, and thresholds as
  `slo_thresholds` or `slo_from_project: true` when there were none. A renamed scenario gets another version from the undo (history is not erased).
  A previous tag with a comma cannot be written back: no undo, and the view says so.
- A new scenario: `scenario_delete` (named only in the log, never in a text) with the new `scenario_id` (level 3: the user decides; the tool never calls it), taken from the data (`created: true`).

## format=data

`project_id`, `scenario_id`, `name` (after the call), `created`, `changes` (`name`, `tags`, `is_active`, `slo`, each `{was, now}`; `slo` as
`{mode: inherited | stock | own, thresholds?}`), `undoable`. Names and tags go through `content()`.

## State and log

State: nothing written. Log: args `{scenario_id}`, result `{name} saved`; the reducer's invalidations follow the catalog table.

UI: text only.
