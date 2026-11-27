# scenario_check_drift — contract

Tool: `scenario_check_drift` (module `scenario`; kind `process`, level 2, class costly, `readOnlyHint: false`, a consent card, `install_allow`
false; text view and `format: "data"`; the description, the annotations, the card and log templates are the catalog's, through
`meta.generated.ts`). Matches the catalog: yes (arguments added to the catalog entry together with this tool). The first tool written on the
block of a long operation (`docs/long-operation.md`); a model for the next ones (`docs/recipe/templates/long-operation.md`).

## Arguments (exactly the catalog's)

- `scenario_id?`: 1–200 characters, the scenario's id or name; default: the only scenario in `ids.scenario_ids`. None: `missing_argument`.
- `reference_source`: `har` or `openapi`, required.
- `reference_id`: 1–128 characters, required: the HAR session id (`har`) or the documentation version id (`openapi`). No default from the state.

No `max_wait_s` (the catalog has none): one call waits at most 100 s and `process_wait` goes on. No `confirm`: the model cannot carry consent.

## The card

Call 1 reads the scenario (`GET …/gatling/scenarios`) and makes the card: title `Check drift of scenario {name}`; lines: the scenario and its
id, the reference (`Compared with the documentation version …` / `…the recorded HAR session …`); cost `about one LLM comparison`; undo
`nothing to undo: it only stores a verdict`. A scenario the project does not have is `not_found` here, before any question. Nothing is
sent. The repeat with the same arguments asks the person in the client's dialog; only the yes starts the check, once.

## The operation (kind `drift_check`)

- **Id and session.** The id of the operation is `dc-<12 hex>` (a hash of the scenario, the source, the reference and the moment); the
  handle is `drift_check:dc-…`. The session id of the backend is derived from it (`driftSessionOf`) and never saved or shown: a field
  called `session_id` is a secret to the plugin, and its value must not reach the state file or the model.
- **Connect first.** The backend sends nothing on connect and does not replay frames. The channel `healthCheck`
  (`/ws/health-check/{session_id}`, flat frames `progress`, `complete`, `error`, `cancelled`) is opened before the request, which is
  `POST /api/scenarios/{scenario_id}/health-check` `{ reference_id, reference_source, session_id }`; the wait follows that same connection
  (`OperationChannel.connectFirst`). A channel that cannot be reached before the start does not stop the check.
- **Progress.** `progress` frames carry the node (`extract_endpoints`, `compare`, `recommend`) and the percent: the line
  `Drift check: comparing with the scenario (60%)` and the fraction. Only these three nodes are drawn, whatever the frame says.
- **Result.** The `complete` frame carries the report and `staleness_score`. A lost channel or a resume after the limit reads the score
  from the cache of the backend (`GET /api/scenarios/{id}/staleness`, `checked_at` not before the start): the result then has no report and says so.
  A check not seen to end within 10 minutes counts as lost (`scenario_drift_failed`).
- **Stop.** `process_cancel` sends `{ type: "cancel" }` on a fresh connection (`cancelMessage`): the answer is `stopping`, because the
  backend marks the session cancelled but does not interrupt a check already running; the check may still end and `process_wait` shows how.
- **Saved** in the operation entry: the scenario id, its masked name, the source, the reference id, the start time. No text of the report.

## format=data

`scenario_id`, `name`, `reference_source`, `reference_id`, `score` (as the backend gave it), `checked_at`, `report` or null:
`current`, `drifted_total` and `drifted[]` (method, path, `modified`/`removed`, details; at most 20), `parameter_drifts_total` and
`parameter_drifts[]` (at most 20), `recommendations` (at most 10), `uncovered_total` and `uncovered` (at most 20).
**Third party:** every name, path, detail, recommendation and the cause of a failure passes `content()`.

## Text view

```
Scenario browse: staleness 0.62 (0 current, 1 stale), checked 2026-11-27 12:00
Compared with the documentation version spec-0001
1 endpoints unchanged, 2 changed or gone, 1 parameter drifts, 1 of the reference not called
  POST /cart: changed (body field qty is now quantity)
  GET /old: gone from the reference
  POST /cart body quantity: type changed from integer to string
recommendations (LoadCraft):
  - Regenerate the scenario from the new documentation
endpoints of the reference the scenario does not call (1):
  GET /wishlist
```

## State

Reads `ids.project_id`, `ids.scenario_ids`. Writes: the row of the operation (the mechanism's: running, then done, failed or cancelled); the
check `steps.scenario.drift` (ok when no endpoint changed or is gone and no parameter drifted; without a report, when the score is 0); a drifted
scenario opens the warning `scenario_drifted` (ref the scenario, a fixed sentence), a clean check closes it. The log carries the name and the score.

## Errors

`scenario_drift_failed` (the cause of the `error` frame, masked, or the lost check; hint: check the reference id) and `scenario_drift_cancelled`
(rows in `skills/loadcraft-test/references/errors-scenario.md`).

## UI

Text only: the mod draws the bar of the operation from the state (`ops/liveProgress.ts`).

## Test cases

`test/tools/scenario/checkDrift.test.ts`: the card (no request, nobody asked, unknown scenario, name and default, arguments outside the
catalog, declined/unticked/cancelled); the check (one request after the yes with the session the channel was joined under, the report, progress,
verdict and problems, log, data, Polish); a long check (handle, `process_wait` with the same view, the same work asked twice runs once, a lost
channel falls back to the cache of the score, `process_cancel`, an error frame); credentials in names, report and cause never reach the model, the
operation entry or the state file. The helpers of the block: `test/tools/kit/operation.test.ts`.

## Out of scope

Reading the cached score alone (`scenario_get` with `include: ["drift"]`), and the report of an earlier check (the backend does not keep it).
