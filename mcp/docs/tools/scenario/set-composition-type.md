# scenario_set_composition_type — contract

Tool: `scenario_set_composition_type` (module `scenario`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view and
`format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments

- `composition_id`: the composition, its id or name, 1 to 200 characters; default: the one of the workspace (`ids.composition_id`), else `missing_argument`.
- `type`: `load_test`, `stress_test`, `soak_test`, `spike_test`, `breakpoint_test` or `capacity_test`, required.
- `spec`: object, required: the parameters of that kind, named in the argument's description: every kind takes `target_users` and `duration_seconds` (positive whole numbers,
  required) and optionally `ramp_up_seconds`, `think_time_ms`, `max_duration_seconds`; `load_test` `ramp_down_seconds`; `stress_test` `stress_multiplier` (above 1); `spike_test` `spike_users`
  (required) and `spike_duration_seconds`; `breakpoint_test` `step_users`, `step_duration_seconds`, `max_steps`; `capacity_test` `target_rps`; other fields are refused. LoadCraft checks them: a 422 is
  `scenario_composition_spec_refused` with the backend's whole text (every field it names, masked, up to 1500 characters) and the list above in its hint; nothing is written; the tool refuses locally only a `spec` that carries its own `type` key (`invalid_arguments`, rule `composition_spec_type`: the kind goes in `type`).
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. The composition is looked up by id or name, then `GET /projects/{id}/gatling/compositions/{composition_id}` once, before the write: the test type it has now
   (the way back).
2. `PUT /projects/{id}/gatling/compositions/{composition_id}/test-type` with `{test_type_spec: {type, ...spec}}`. The backend re-links the members (new link ids) and
   answers with the composition and `feeder_advice`: per member, its datasets with the rows the new type needs.
3. The same type and spec the composition already has: nothing is written (`changed: false`, inert, no undo entry).

## format=data

`project_id`, `composition` (`id`), `name` (masked), `type`, `previous_type` (null when the composition had none), `changed`, `short` (datasets that have fewer rows than the new
type needs), `advice[]` (`scenario`, `dataset`, `required`, `rows`, `strategy`, `refusal`; only the short ones, at most 20), `undo` (`kept`, `no_previous`, `unknown_previous`, `none`).
The number a dataset needs is the backend's (`feeder_advice`), sized by the dataset's iteration strategy, not by `target_users`: circular and random by twice the peak of concurrent sessions, queue and shuffle by arrival rate times duration times a safety margin; the view says which rule and, when the backend sized no rows, why (`required_row_count_refusal`).
**Third party:** names pass `content()`.

## Text view

```
"mix" now runs a stress_test (previous: load_test).
Data to grow: browse: products has 40 rows, 200 needed.
```

Nothing short: `Every dataset already has the rows the new type needs.` Unchanged: `"mix" already runs this stress_test; nothing changed.`

## Undo

`undo: {tool: "scenario_set_composition_type", args: {composition_id, type: <the previous type>, spec: <its parameters>}}`. A composition that had no type before has no
undo entry (the backend cannot unset a type) and the view says so, as it does for a previous type this tool does not set (`undo: no_previous` / `unknown_previous`), and neither has a call that changed nothing or failed. The datasets are not changed by this tool, so there is
nothing to give back; the members get new link ids on every call, as the backend does.

## State

Reads `ids.project_id`, `ids.composition_id`. The checks `scenario.compiled`, `data.datasets_ready` and `run.planned` are reset by the reducer through the table of the
catalog (trigger `scenario_set_composition_type`); an unchanged call resets nothing.

## UI

Text only.

## Test cases

- Ordinary: set a stress test over a load test; the composition in the fake holds the new spec; one read and one write; by id and by name; the advice names the short datasets.
- Undo: write, take the undo from the log, call it; the composition's spec is as before.
- Invalidation: the three checks go to null after a change; none after an unchanged or a refused call.
- Edge: the same type and spec again (no PUT, no undo); no previous type (no undo); a spec the backend refuses (422, nothing written, no undo entry); `spec` with `type`;
  an unknown type; unknown composition; no `composition_id` with none in the state; unknown argument; no bound project; Polish view; log entry.
- Adversary: sentinel in the names; instruction in a name; control sequences.

## Out of scope

Saving a composition (`scenario_save_composition`), changing the members' data (`data_*`).
