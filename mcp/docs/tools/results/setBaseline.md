# M-RESULTS-02 — contract

Tool: `results_set_baseline` (module `results`; level 1, class write, no card; `readOnlyHint: false`, `destructiveHint: false`;
undo: yes, the same tool with the previous baseline run; all as in the catalog, matching).

Arguments (exactly the catalog's): `run_id?` — a run handle (`e-1a2b3c4d`) or a UUID, default `ids.run_id` of the state (same
validation as the reads of the module); `format`. The project is the bound one.

API operations, in order:

1. `GET …/executions/{id}/baseline` — the baseline the pair of scenario and load has now: `state`, `baseline.execution_id`,
   `baseline.is_this_execution`, `baseline.has_measurements`. A 409 (no pair to pin for) is `results_baseline_refused`, nothing written.
2. `PUT …/executions/{id}/baseline` — pins the run. Not sent when the run already is the baseline. A 409 (a self-check run, no
   scenario and load, no result) is `results_baseline_refused`.

format=data: `run_id` (handle), `execution_id` (UUID), `changed`, `previous` (`run_id`, `execution_id`, `has_measurements`, or null),
`undoable`. No text of a third party.

Text view:

```
run e-3f9a12c4 is now the baseline of its scenario and load
before: e-8c2d4f17 (the backend does not say whether it was pinned or adopted automatically)
→ undo: results_set_baseline with run_id "<uuid of the previous baseline>"
```

The backend does not say whether a baseline was pinned by hand or adopted automatically (a pair's first measured run is adopted), so
the view says so and never claims either.

State: nothing read or written (`state_reads` ids.project_id, ids.run_id; no writes). Log entry: args `{run_id}`, result
`run {run_id} is the baseline`, undo `results_set_baseline {run_id: <previous baseline>}` — present only when the previous baseline
has measurements. With no previous baseline there is no undo entry: the backend has no call that removes a baseline (removing a pin is not possible).

UI: text only; a write of level 1 with a one-line answer needs no panel.

Tests: the pin with a previous baseline (view, data, requests, log entry); write, undo from the log, the pair as before; no previous
baseline (no undo); unmeasured previous baseline (no undo); already the baseline (no write, no undo); a refused write (nothing
changed, no undo); argument outside the catalog and a malformed run (no request); unknown run; Polish view; sentinel case.
